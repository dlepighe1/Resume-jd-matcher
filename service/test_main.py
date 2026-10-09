"""Tests for the scoring service, fully offline.

The dependency-injected Scorer is replaced with one holding a scripted stub encoder, so
no test here downloads MPNet, touches the HuggingFace Hub, or loads 420 MB of weights.
That is the whole reason get_scorer() is a FastAPI dependency rather than a global read.
"""

import re
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from app.explain import COVERED_THRESHOLD, PARTIAL_THRESHOLD  # noqa: E402
from service import main  # noqa: E402
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

# 3-D vectors: the two resume sentences sit on the x and y axes, and each requirement's
# z-component is "content the resume doesn't have", which is what pushes it out of the
# covered band. Same trick as tests/test_explain.py, and derived from the thresholds for
# the same reason: typed literals quietly stopped matching their bands when the thresholds
# moved to the values scripts/eval_explanations.py measured.
def _at_cosine(target: float) -> list[float]:
    """Unit vector whose cosine against resume sentence 0 is exactly `target`."""
    return [target, 0.0, float((1 - target**2) ** 0.5)]


COVERED = _at_cosine((COVERED_THRESHOLD + 1.0) / 2)
PARTIAL = _at_cosine((COVERED_THRESHOLD + PARTIAL_THRESHOLD) / 2)
MISSING = _at_cosine(PARTIAL_THRESHOLD / 2)


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
    assert len(reqs) == 3, "fixture JD changed, rebuild the vectors"
    assert len(sents) >= 2, "fixture resume changed, rebuild the vectors"

    vectors: dict[str, list[float]] = {sents[0]: [1.0, 0.0, 0.0]}
    for sentence in sents[1:]:
        vectors[sentence] = [0.0, 1.0, 0.0]
    vectors[reqs[0]] = COVERED
    vectors[reqs[1]] = PARTIAL
    vectors[reqs[2]] = MISSING

    def build(calibrator=None, calibrator_name=None, fine_tuned=True):
        # The whole-document embeddings (resume vs JD) fall through to the default
        # vector, giving a raw cosine of 1.0, the calibrator's input is what's under
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
        """finetuned.ts reads exactly these keys, a rename here breaks the app silently."""
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


class TestInputLimits:
    """The service is reachable without going through Next.js, so it cannot inherit the
    15,000-character cap the web route applies."""

    def test_rejects_a_resume_past_the_character_cap(self, client):
        oversized = "word " * 20_000
        response = client().post("/score", json={"resume": oversized, "jd": JD})

        assert response.status_code == 422

    def test_rejects_a_job_description_past_the_character_cap(self, client):
        oversized = "word " * 20_000
        response = client().post("/score", json={"resume": RESUME, "jd": oversized})

        assert response.status_code == 422

    def test_the_cap_matches_the_one_the_web_route_enforces(self):
        """If these drift apart, one layer silently accepts what the other rejects and the
        demo fails in a way that reads like a model problem."""
        route = (Path(__file__).resolve().parents[1] / "web" / "app" / "api" / "score"
                 / "route.ts")
        if not route.exists():
            pytest.skip("web/ is not present")

        declared = re.search(r"const MAX_CHARS = ([\d_]+);", route.read_text(encoding="utf-8"))
        assert declared, "web route no longer declares MAX_CHARS; the check cannot run"
        assert int(declared.group(1).replace("_", "")) == main.MAX_CHARS, (
            "service and web disagree about the maximum input size"
        )

    def test_the_baseline_endpoint_is_capped_too(self, client):
        """It runs a second 420 MB model on the same untruncated text."""
        oversized = "word " * 20_000
        response = client().post("/baseline", json={"resume": oversized, "jd": JD})

        assert response.status_code == 422


class TestRateLimit:
    def test_allows_traffic_inside_the_budget(self):
        limiter = main.SlidingWindowLimiter(limit=3, window_seconds=60)

        assert [limiter.allow("1.2.3.4", now=0.0) for _ in range(3)] == [True] * 3

    def test_refuses_the_request_past_the_budget(self):
        limiter = main.SlidingWindowLimiter(limit=2, window_seconds=60)
        for _ in range(2):
            limiter.allow("1.2.3.4", now=0.0)

        assert limiter.allow("1.2.3.4", now=0.0) is False

    def test_the_window_slides_rather_than_resetting_on_a_boundary(self):
        """A fixed window lets a client spend its whole budget twice across the boundary.
        Old timestamps expiring individually is what prevents that."""
        limiter = main.SlidingWindowLimiter(limit=2, window_seconds=60)
        limiter.allow("1.2.3.4", now=0.0)
        limiter.allow("1.2.3.4", now=30.0)

        assert limiter.allow("1.2.3.4", now=59.0) is False
        assert limiter.allow("1.2.3.4", now=61.0) is True   # the 0.0 hit has aged out
        assert limiter.allow("1.2.3.4", now=61.0) is False  # the 30.0 hit has not

    def test_budgets_are_per_client_address(self):
        limiter = main.SlidingWindowLimiter(limit=1, window_seconds=60)
        limiter.allow("1.2.3.4", now=0.0)

        assert limiter.allow("5.6.7.8", now=0.0) is True

    def test_retry_after_is_never_zero_while_a_client_is_blocked(self):
        """A Retry-After of 0 invites an immediate retry, which is the opposite of what a
        limiter is for."""
        limiter = main.SlidingWindowLimiter(limit=1, window_seconds=60)
        limiter.allow("1.2.3.4", now=10.0)

        assert limiter.retry_after("1.2.3.4", now=69.0) >= 1

    def test_an_unseen_client_is_told_to_retry_immediately(self):
        limiter = main.SlidingWindowLimiter(limit=1, window_seconds=60)

        assert limiter.retry_after("never-seen", now=0.0) == 0

    def test_the_endpoint_returns_429_with_a_retry_after_header(self, client, monkeypatch):
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 2)
        monkeypatch.setattr(main, "limiter", main.SlidingWindowLimiter(2, 60))
        c = client()

        first = [c.post("/score", json={"resume": RESUME, "jd": JD}) for _ in range(2)]
        blocked = c.post("/score", json={"resume": RESUME, "jd": JD})

        assert all(r.status_code == 200 for r in first)
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) >= 1

    def test_health_is_never_rate_limited(self, client, monkeypatch):
        """It is what a platform polls to decide the container is alive. Limiting it is how
        a service gets restarted for being busy."""
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
        monkeypatch.setattr(main, "limiter", main.SlidingWindowLimiter(1, 60))
        c = client()

        assert all(c.get("/health").status_code == 200 for _ in range(5))

    def test_setting_the_limit_to_zero_disables_it_for_local_runs(self, client, monkeypatch):
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 0)
        c = client()

        responses = [c.post("/score", json={"resume": RESUME, "jd": JD}) for _ in range(6)]
        assert all(r.status_code == 200 for r in responses)


class TestClientIdentity:
    """Behind Vercel, every request arrives from Vercel's servers, so keying the limiter on
    the socket address would make one budget shared by every visitor. The web app forwards
    the visitor's address, and the service believes it only alongside the shared secret,
    because anyone calling the service directly could otherwise pick a fresh address per
    request and never be limited at all."""

    SECRET = "s3cret"

    def _blocked_after_one(self, c, headers_first, headers_second):
        c.post("/score", json={"resume": RESUME, "jd": JD}, headers=headers_first)
        return c.post("/score", json={"resume": RESUME, "jd": JD}, headers=headers_second)

    @pytest.fixture
    def one_per_client(self, client, monkeypatch):
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
        monkeypatch.setattr(main, "limiter", main.SlidingWindowLimiter(1, 60))
        monkeypatch.setattr(main, "PROXY_SECRET", self.SECRET)
        return client()

    def test_forwarded_visitors_get_separate_budgets_with_the_secret(self, one_per_client):
        second = self._blocked_after_one(
            one_per_client,
            {"X-Proxy-Secret": self.SECRET, "X-Client-IP": "1.1.1.1"},
            {"X-Proxy-Secret": self.SECRET, "X-Client-IP": "2.2.2.2"},
        )
        assert second.status_code == 200

    def test_the_same_forwarded_visitor_is_still_limited(self, one_per_client):
        headers = {"X-Proxy-Secret": self.SECRET, "X-Client-IP": "1.1.1.1"}
        assert self._blocked_after_one(one_per_client, headers, headers).status_code == 429

    def test_a_forwarded_address_without_the_secret_is_ignored(self, one_per_client):
        second = self._blocked_after_one(
            one_per_client,
            {"X-Proxy-Secret": "wrong", "X-Client-IP": "1.1.1.1"},
            {"X-Proxy-Secret": "wrong", "X-Client-IP": "2.2.2.2"},
        )
        assert second.status_code == 429

    def test_forwarding_is_off_when_no_secret_is_configured(self, client, monkeypatch):
        monkeypatch.setattr(main, "RATE_LIMIT_REQUESTS", 1)
        monkeypatch.setattr(main, "limiter", main.SlidingWindowLimiter(1, 60))
        monkeypatch.setattr(main, "PROXY_SECRET", "")
        second = self._blocked_after_one(
            client(),
            {"X-Proxy-Secret": "", "X-Client-IP": "1.1.1.1"},
            {"X-Proxy-Secret": "", "X-Client-IP": "2.2.2.2"},
        )
        assert second.status_code == 429
