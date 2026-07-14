"""Scoring service — serves the fine-tuned MPNet + Platt calibrator over HTTP.

The model is ~420 MB of PyTorch weights, which is far past what a Vercel serverless
function can hold, so it lives here and Next.js calls it via SCORING_SERVICE_URL.

This deliberately imports the model code that already exists in this repo rather than
reimplementing it:
  - src.text_utils   the exact preprocessing the model was trained under
  - app.explain      requirement-by-requirement skill-gap analysis
Reimplementing either would let the served scores silently drift away from the numbers
in the research notebooks, which is the one thing that would make this whole project
dishonest.

Run locally:  uvicorn service.main:app --reload --port 8000   (from the repo root)
"""

import logging
import os
import pickle
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Must run before anything imports huggingface_hub. On machines behind a TLS-inspecting
# proxy (corporate networks, some AV), Python's bundled CA store cannot verify
# huggingface.co and every model download dies with CERTIFICATE_VERIFY_FAILED — which
# then closes hf_hub's shared HTTP client, so even the cached fallback load fails with a
# confusing "client has been closed". Verifying against the OS cert store fixes it.
# No-op on Linux/containers, so it is safe to leave in for the HuggingFace Space too.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.metrics.pairwise import cosine_similarity

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from app.explain import analyze_skill_gap  # noqa: E402
from src.text_utils import preprocess_resume, smart_truncate_jd  # noqa: E402

log = logging.getLogger("uvicorn.error")

MODEL_ID = os.getenv("MODEL_ID", "dlepighe1/resume-jd-matcher-mpnet")
LOCAL_MODEL_DIR = REPO_ROOT / "models" / "mpnet-resume-matcher"
BASE_MODEL = "all-mpnet-base-v2"
# Platt is the production calibrator (a 2-parameter sigmoid cannot overfit a 106-pair
# calibration split); isotonic is the fallback.
CALIBRATOR_PATHS = [
    REPO_ROOT / "models" / "platt_calibrator.pkl",
    REPO_ROOT / "models" / "isotonic_calibrator.pkl",
]
MAX_WORDS = 350
MIN_WORDS = 50


class ScoreRequest(BaseModel):
    resume: str = Field(min_length=1)
    jd: str = Field(min_length=1)


class RequirementMatchOut(BaseModel):
    requirement: str
    status: str  # covered | partial | missing
    similarity: float
    evidence: str


class ScoreResponse(BaseModel):
    score: float  # 0-1, calibrated when a calibrator is loaded
    raw_cosine: float
    calibrator: str | None
    model_id: str
    requirements: list[RequirementMatchOut]
    coverage: float


class HealthResponse(BaseModel):
    status: str
    model_id: str
    calibrator: str | None
    fine_tuned: bool


class Scorer:
    """Holds the loaded model. Constructed once at startup — loading MPNet per request
    would add seconds of latency to every call."""

    def __init__(self, model, calibrator, calibrator_name: str | None, model_id: str,
                 fine_tuned: bool):
        self.model = model
        self.calibrator = calibrator
        self.calibrator_name = calibrator_name
        self.model_id = model_id
        self.fine_tuned = fine_tuned

    def calibrate(self, raw: float) -> float:
        if self.calibrator is None:
            return max(0.0, min(1.0, raw))
        if hasattr(self.calibrator, "predict"):  # sklearn IsotonicRegression
            return float(self.calibrator.predict([raw])[0])
        return float(self.calibrator([raw])[0])  # PlattCalibrator is callable

    def score(self, resume: str, jd: str) -> ScoreResponse:
        # Same 350-word preprocessing the model was trained under. Skipping it would
        # feed the model inputs it never saw in training and quietly degrade the score.
        resume_clean = preprocess_resume(resume, MAX_WORDS)
        jd_clean = smart_truncate_jd(jd, MAX_WORDS)

        r_emb = self.model.encode([resume_clean], show_progress_bar=False, convert_to_numpy=True)
        j_emb = self.model.encode([jd_clean], show_progress_bar=False, convert_to_numpy=True)
        raw = float(cosine_similarity(r_emb, j_emb)[0][0])

        # The skill gap runs on the *unpreprocessed* text: extract_requirements does its
        # own JD reduction, and truncating the resume first would hide evidence sentences
        # past the 350-word cut.
        matches, coverage = analyze_skill_gap(self.model, resume, jd)

        return ScoreResponse(
            score=round(self.calibrate(raw), 4),
            raw_cosine=round(raw, 4),
            calibrator=self.calibrator_name,
            model_id=self.model_id,
            requirements=[
                RequirementMatchOut(
                    requirement=m.requirement,
                    status=m.status,
                    similarity=round(m.similarity, 4),
                    evidence=m.evidence,
                )
                for m in matches
            ],
            coverage=round(coverage, 4),
        )


def _load_calibrator():
    """Load the first available calibrator pickle.

    Calibrators pickled inside a Colab notebook record their class as __main__.
    PlattCalibrator, so register it there or unpickling raises AttributeError.
    """
    import __main__

    from src.train import PlattCalibrator

    __main__.PlattCalibrator = PlattCalibrator

    for path in CALIBRATOR_PATHS:
        if path.exists():
            with open(path, "rb") as f:
                return pickle.load(f), path.stem.replace("_calibrator", "")
    return None, None


def load_scorer() -> Scorer:
    """Resolve a model: local checkpoint, then HF Hub, then base MPNet."""
    from sentence_transformers import SentenceTransformer

    calibrator, calibrator_name = _load_calibrator()

    if LOCAL_MODEL_DIR.exists():
        log.info("Loading fine-tuned model from %s", LOCAL_MODEL_DIR)
        model = SentenceTransformer(str(LOCAL_MODEL_DIR))
        return Scorer(model, calibrator, calibrator_name, str(LOCAL_MODEL_DIR), True)

    try:
        log.info("Loading fine-tuned model from the HuggingFace Hub: %s", MODEL_ID)
        model = SentenceTransformer(MODEL_ID)
        return Scorer(model, calibrator, calibrator_name, MODEL_ID, True)
    except Exception as error:
        # Say why. Swallowing this silently is how a TLS or auth problem gets mistaken
        # for "the model just isn't published yet" and costs an afternoon.
        log.warning("Could not load %s (%s: %s)", MODEL_ID, type(error).__name__, error)

    # Last resort. The calibrators map the FINE-TUNED model's cosine distribution, so
    # applying one to base MPNet would produce confident, well-formatted nonsense —
    # drop the calibrator and report fine_tuned=false so the UI can say so.
    log.warning("Falling back to base %s — scores will be UNCALIBRATED.", BASE_MODEL)
    model = SentenceTransformer(BASE_MODEL)
    return Scorer(model, None, None, f"{BASE_MODEL} (fallback)", False)


_scorer: Scorer | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _scorer
    _scorer = load_scorer()
    yield
    _scorer = None


def get_scorer() -> Scorer:
    """FastAPI dependency. Tests override this with a stub encoder, which is what keeps
    the service's test suite offline and fast."""
    if _scorer is None:
        raise HTTPException(status_code=503, detail="Model is still loading.")
    return _scorer


app = FastAPI(title="ResumeAI scoring service", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
def health(scorer: Scorer = Depends(get_scorer)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_id=scorer.model_id,
        calibrator=scorer.calibrator_name,
        fine_tuned=scorer.fine_tuned,
    )


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest, scorer: Scorer = Depends(get_scorer)) -> ScoreResponse:
    # Also enforced upstream in Next.js, but this service is independently reachable, so
    # it does not get to assume its caller validated anything.
    for name, text in (("resume", request.resume), ("jd", request.jd)):
        if len(text.split()) < MIN_WORDS:
            raise HTTPException(
                status_code=422,
                detail=f"{name} needs at least {MIN_WORDS} words to score meaningfully.",
            )

    return scorer.score(request.resume, request.jd)
