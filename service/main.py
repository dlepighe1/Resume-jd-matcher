"""Scoring service, serves the fine-tuned MPNet + Platt calibrator over HTTP.

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

import hmac
import logging
import os
import pickle
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

# Must run before anything imports huggingface_hub. On machines behind a TLS-inspecting
# proxy (corporate networks, some AV), Python's bundled CA store cannot verify
# huggingface.co and every model download dies with CERTIFICATE_VERIFY_FAILED, which
# then closes hf_hub's shared HTTP client, so even the cached fallback load fails with a
# confusing "client has been closed". Verifying against the OS cert store fixes it.
# No-op on Linux/containers, so it is safe to leave in for the deployed image too.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

from fastapi import Depends, FastAPI, HTTPException, Request
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

# Matches the cap web/app/api/score/route.ts already applies. This service is reachable
# without going through Next.js, so it does not get to inherit that check.
#
# The cap is not cosmetic. `score()` truncates to MAX_WORDS before encoding, but
# `analyze_skill_gap` deliberately runs on the untruncated text, so its cost grows with the
# input: a megabyte of pasted text becomes thousands of sentences to embed, on a CPU
# container, inside one request. Rejecting it at the edge is cheaper than discovering it
# under load.
MAX_CHARS = 15_000

# Per-client-address budget. A public demo endpoint that runs a 109M-parameter model per
# call needs some ceiling, and this is the smallest one that does not need a datastore.
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "30"))
RATE_LIMIT_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))

# Shared with the web app (SCORING_SERVICE_SECRET there). Every request the web app makes
# comes from Vercel's servers, so without this the limiter above would hold one budget
# for every visitor combined. With it, the web app forwards the visitor's address in
# X-Client-IP and the service trusts that header only when the secret matches.
PROXY_SECRET = os.getenv("PROXY_SECRET", "")


class ScoreRequest(BaseModel):
    resume: str = Field(min_length=1, max_length=MAX_CHARS)
    jd: str = Field(min_length=1, max_length=MAX_CHARS)


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


class BaselineResponse(BaseModel):
    """Raw cosine from the un-fine-tuned base model.

    There is deliberately no `score` field and no calibrator here. The calibrators map the
    FINE-TUNED model's cosine distribution; applying one to base MPNet would produce a
    confident, well-formatted number that means nothing. The field name says `raw_cosine`
    so no caller can mistake it for a calibrated score.
    """

    raw_cosine: float
    model_id: str
    calibrated: bool = False


class Scorer:
    """Holds the loaded model. Constructed once at startup, loading MPNet per request
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
    # applying one to base MPNet would produce confident, well-formatted nonsense.
    # Drop the calibrator and report fine_tuned=false so the UI can say so.
    log.warning("Falling back to base %s, scores will be UNCALIBRATED.", BASE_MODEL)
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


class SlidingWindowLimiter:
    """Fixed budget per client address over a sliding window, held in memory.

    In-process on purpose. The alternative is a datastore, and a research demo that ships
    one model on one container does not need shared state to answer "has this address
    already had thirty scores this minute". The consequence is stated rather than
    discovered: run more than one replica and each gets its own budget.

    Timestamps older than the window are dropped on read, so an idle client costs nothing
    and the structure cannot grow without bound while traffic is bounded.
    """

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, client: str, now: float) -> bool:
        recent = [t for t in self._hits.get(client, []) if now - t < self.window]
        if len(recent) >= self.limit:
            self._hits[client] = recent
            return False
        recent.append(now)
        self._hits[client] = recent
        return True

    def retry_after(self, client: str, now: float) -> int:
        recent = self._hits.get(client, [])
        if not recent:
            return 0
        return max(1, int(self.window - (now - min(recent))) + 1)


limiter = SlidingWindowLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_SECONDS)


def client_key(request: Request) -> str:
    """Who a request is charged to.

    The forwarded address is believed only alongside the shared secret. Anyone calling the
    service directly could otherwise send a fresh X-Client-IP per request and never hit
    the limit. Direct callers are keyed on the socket address, which behind the hosting
    platform's proxy means they share one budget, and that is acceptable for callers who
    skipped the web app.
    """
    forwarded = request.headers.get("x-client-ip", "").strip()
    supplied = request.headers.get("x-proxy-secret", "")
    if PROXY_SECRET and forwarded and hmac.compare_digest(supplied, PROXY_SECRET):
        return forwarded
    return request.client.host if request.client else "unknown"


def enforce_rate_limit(request: Request) -> None:
    """FastAPI dependency guarding the two endpoints that run a model.

    /health is deliberately exempt: it is what a platform polls to decide whether the
    container is alive, and rate-limiting a liveness probe is how a service gets restarted
    for being busy.
    """
    if RATE_LIMIT_REQUESTS <= 0:  # explicit opt-out for local development
        return
    client = client_key(request)
    now = time.monotonic()
    if not limiter.allow(client, now):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit is {RATE_LIMIT_REQUESTS} requests per "
                   f"{int(RATE_LIMIT_WINDOW_SECONDS)}s.",
            headers={"Retry-After": str(limiter.retry_after(client, now))},
        )


@app.get("/health", response_model=HealthResponse)
def health(scorer: Scorer = Depends(get_scorer)) -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_id=scorer.model_id,
        calibrator=scorer.calibrator_name,
        fine_tuned=scorer.fine_tuned,
    )


def _validate(request: ScoreRequest) -> None:
    # Also enforced upstream in Next.js, but this service is independently reachable, so
    # it does not get to assume its caller validated anything.
    for name, text in (("resume", request.resume), ("jd", request.jd)):
        if len(text.split()) < MIN_WORDS:
            raise HTTPException(
                status_code=422,
                detail=f"{name} needs at least {MIN_WORDS} words to score meaningfully.",
            )


@app.post("/score", response_model=ScoreResponse)
def score(request: ScoreRequest, scorer: Scorer = Depends(get_scorer),
          _: None = Depends(enforce_rate_limit)) -> ScoreResponse:
    _validate(request)
    return scorer.score(request.resume, request.jd)


# Loaded on first use, not at startup: most requests never touch it, and holding a second
# 420 MB model resident would double the container's memory and cold-start cost for a
# comparison feature. The demo surfaces the first-call delay rather than hiding it.
_base_model = None


@app.post("/baseline", response_model=BaselineResponse)
def baseline(request: ScoreRequest,
             _: None = Depends(enforce_rate_limit)) -> BaselineResponse:
    """Score the same pair with un-fine-tuned MPNet.

    This exists so the demo can show what fine-tuning bought on the visitor's own text
    rather than only on the benchmark. Returns raw cosine only, see BaselineResponse.
    """
    global _base_model
    _validate(request)

    if _base_model is None:
        from sentence_transformers import SentenceTransformer

        log.info("Loading base %s for the baseline endpoint (first call)", BASE_MODEL)
        _base_model = SentenceTransformer(BASE_MODEL)

    # Same preprocessing as the fine-tuned path. Comparing a preprocessed input against a
    # raw one would measure preprocessing, not fine-tuning.
    resume_clean = preprocess_resume(request.resume, MAX_WORDS)
    jd_clean = smart_truncate_jd(request.jd, MAX_WORDS)

    r_emb = _base_model.encode([resume_clean], show_progress_bar=False, convert_to_numpy=True)
    j_emb = _base_model.encode([jd_clean], show_progress_bar=False, convert_to_numpy=True)

    return BaselineResponse(
        raw_cosine=round(float(cosine_similarity(r_emb, j_emb)[0][0]), 4),
        model_id=BASE_MODEL,
    )
