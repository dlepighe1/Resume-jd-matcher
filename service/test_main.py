"""Tests for the scoring service — fully offline.

The dependency-injected Scorer is replaced with one holding a scripted stub encoder, so
no test here downloads MPNet, touches the HuggingFace Hub, or loads 420 MB of weights.
That is the whole reason get_scorer() is a FastAPI dependency rather than a global read.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from service.main import Scorer, app, get_scorer  # noqa: E402
from src.text_utils import extract_requirements, split_sentences  # noqa: E402
from src.train import PlattCalibrator  # noqa: E402

JD = """Acme Corp builds cloud logistics software for global shippers, serving customers
in five countries and processing millions of shipments every single quarter of the year.

Requirements:
- Three or more years of professional experience with Python and SQL.
- Hands-on experience building ETL pipelines with Airflow in production.
- Experience designing and analyzing A/B tests and experiments at scale.
"""

RESUME = """Jane Smith is a data engineer with four years of professional experience
building and operating batch data pipelines for analytics teams across the business.
She built ETL pipelines in Airflow processing two terabytes of data daily at Beta.
Her core stack is Python, SQL, dbt, and Docker, plus AWS services in production daily.
"""

# Hand-chosen 3-D vectors: the two resume sentences sit on the x and y axes, and each
# requirement's z-component is "content the resume doesn't have" — which is what pushes
# it out of the covered band. Same trick as tests/test_explain.py.
COVERED = [0.95, 0.1, 0.29]  # best cosine ~0.95
PARTIAL = [0.42, 0.1, 0.90]  # best cosine ~0.42
MISSING = [0.10, 0.05, 0.99]  # best cosine ~0.10


class ScriptedEncoder:
    """Stub SentenceTransformer. Returns a caller-chosen vector per exact text, so the
    similarity bands under test are exact rather than a property of real embeddings."""

    def __init__(self, vectors: dict[str, list[float]], default: list[float]):
        self.vectors = vectors
        self.default = default
        self.seen: list[str] = []

    def encode(self, texts, **_kwargs):
        self.seen.extend(texts)
        return np.array([self.vectors.get(t, self.default) for t in texts], dtype=float)


@pytest.fixture
def scorer_factory():
    reqs = extract_requirements(JD)
    sents = split_sentences(RESUME)
    assert len(reqs) == 3, "fixture JD changed — rebuild the vectors"
    assert len(sents) >= 2, "fixture resume changed — rebuild the vectors"

    vectors: dict[str, list[float]] = {sents[0]: [1.0, 0.0, 0.0]}
    for sentence in sents[1:]:
        vectors[sentence] = [0.0, 1.0, 0.0]
    vectors[reqs[0]] = COVERED
    vectors[reqs[1]] = PARTIAL
    vectors[reqs[2]] = MISSING

    def build(calibrator=None, calibrator_name=None, fine_tuned=True):
        # The whole-document embeddings (resume vs JD) fall through to the default
        # vector, giving a raw cosine of 1.0 — the calibrator's input is what's under
        # test here, not the encoder's geometry.
        encoder = ScriptedEncoder(vectors, default=[1.0, 0.0, 0.0])
        return Scorer(encoder, calibrator, calibrator_name, "test-model", fine_tuned)

    return build


@pytest.fixture
def client(scorer_factory):
    def make(**kwargs):
        app.dependency_overrides[get_scorer] = lambda: scorer_factory(**kwargs)
        return TestClient(app)

    yield make
    app.dependency_overrides.clear()


class TestScore:
    def test_bands_each_requirement_by_its_closest_resume_sentence(self, client):
        body = client().post("/score", json={"resume": RESUME, "jd": JD}).json()

        assert [r["status"] for r in body["requirements"]] == ["covered", "partial", "missing"]

    def test_missing_requirement_carries_no_evidence(self, client):
        body = client().post("/score", json={"resume": RESUME, "jd": JD}).json()

        missing = next(r for r in body["requirements"] if r["status"] == "missing")
        assert missing["evidence"] == ""

    def test_coverage_counts_partial_as_half(self, client):
        body = client().post("/score", json={"resume": RESUME, "jd": JD}).json()

        assert body["coverage"] == pytest.approx((1 + 0.5) / 3, abs=1e-3)

    def test_uncalibrated_score_is_the_clamped_raw_cosine(self, client):
        body = client().post("/score", json={"resume": RESUME, "jd": JD}).json()

        assert body["calibrator"] is None
        assert body["score"] == pytest.approx(body["raw_cosine"], abs=1e-3)

    def test_platt_calibrator_is_applied_to_the_raw_cosine(self, client):
        platt = PlattCalibrator()
        platt.a, platt.b = 4.0, -2.0  # sigmoid(4 * 1.0 - 2.0) = sigmoid(2) = 0.8808

        body = client(calibrator=platt, calibrator_name="platt").post(
            "/score", json={"resume": RESUME, "jd": JD}
        ).json()

        assert body["calibrator"] == "platt"
        assert body["raw_cosine"] == pytest.approx(1.0, abs=1e-3)
        assert body["score"] == pytest.approx(1 / (1 + np.exp(-2.0)), abs=1e-3)

    def test_response_shape_matches_what_the_web_provider_expects(self, client):
        """finetuned.ts reads exactly these keys — a rename here breaks the app silently."""
        body = client().post("/score", json={"resume": RESUME, "jd": JD}).json()

        assert set(body) == {
            "score",
            "raw_cosine",
            "calibrator",
            "model_id",
            "requirements",
            "coverage",
        }
        assert set(body["requirements"][0]) == {
            "requirement",
            "status",
            "similarity",
            "evidence",
        }


class TestPreprocessing:
    def test_long_inputs_are_truncated_to_the_length_the_model_was_trained_on(
        self, scorer_factory
    ):
        """The model saw 350-word inputs in training. Feeding it a 900-word resume at
        serve time would quietly degrade the score against the published numbers."""
        scorer = scorer_factory()
        long_resume = "skill " * 900
        long_jd = "filler " * 900 + " Requirements: Python and SQL needed for this role."

        scorer.score(long_resume, long_jd)

        # The first two encode() calls are the whole-document pair the score is built on.
        pair = scorer.model.seen[:2]
        assert all(len(text.split()) <= 350 for text in pair)


class TestModelResolution:
    """load_scorer() falls back to base MPNet when no fine-tuned weights are reachable.
    The calibrators map the FINE-TUNED model's cosine distribution, so applying one to
    base MPNet would produce confident, well-formatted nonsense."""

    @pytest.fixture
    def fake_transformers(self, monkeypatch, tmp_path):
        import types

        from service import main as service_main

        monkeypatch.setattr(service_main, "LOCAL_MODEL_DIR", tmp_path / "absent")
        monkeypatch.setattr(
            service_main, "_load_calibrator", lambda: (PlattCalibrator(), "platt")
        )

        def install(*, hub_available: bool):
            module = types.ModuleType("sentence_transformers")

            def SentenceTransformer(name):  # noqa: N802 - mirrors the real class name
                if name == service_main.BASE_MODEL:
                    return ScriptedEncoder({}, default=[1.0, 0.0, 0.0])
                if hub_available:
                    return ScriptedEncoder({}, default=[1.0, 0.0, 0.0])
                raise OSError("model not found on the hub")

            module.SentenceTransformer = SentenceTransformer
            monkeypatch.setitem(sys.modules, "sentence_transformers", module)

        return install

    def test_keeps_the_calibrator_when_the_fine_tuned_model_loads(self, fake_transformers):
        from service.main import load_scorer

        fake_transformers(hub_available=True)
        scorer = load_scorer()

        assert scorer.fine_tuned is True
        assert scorer.calibrator_name == "platt"

    def test_drops_the_calibrator_when_falling_back_to_base_mpnet(self, fake_transformers):
        from service.main import load_scorer

        fake_transformers(hub_available=False)
        scorer = load_scorer()

        assert scorer.fine_tuned is False
        assert scorer.calibrator is None, "a fine-tuned calibrator must never be applied to base MPNet"
        assert scorer.calibrator_name is None


class TestValidation:
    def test_rejects_a_too_short_resume(self, client):
        response = client().post("/score", json={"resume": "I know Python.", "jd": JD})

        assert response.status_code == 422
        assert "resume" in response.json()["detail"]

    def test_rejects_a_too_short_jd(self, client):
        response = client().post("/score", json={"resume": RESUME, "jd": "Python dev wanted."})

        assert response.status_code == 422
        assert "jd" in response.json()["detail"]

    def test_rejects_an_empty_body(self, client):
        assert client().post("/score", json={}).status_code == 422


class TestHealth:
    def test_reports_the_loaded_model(self, client):
        body = client(calibrator=PlattCalibrator(), calibrator_name="platt").get("/health").json()

        assert body == {
            "status": "ok",
            "model_id": "test-model",
            "calibrator": "platt",
            "fine_tuned": True,
        }

    def test_reports_the_uncalibrated_fallback(self, client):
        body = client(fine_tuned=False).get("/health").json()

        assert body["fine_tuned"] is False
        assert body["calibrator"] is None
