"""Tests for app/explain.py — the skill-gap explanation shown under every score.

Embeddings come from a scripted stub, so each requirement's similarity to each
resume sentence is exact and the covered/partial/missing bands are tested as
logic rather than as a property of real MPNet vectors.
"""

import pytest

from app.explain import COVERED_THRESHOLD, PARTIAL_THRESHOLD, analyze_skill_gap, verdict_band
from conftest import ScriptedEncoder
from src.text_utils import extract_requirements, split_sentences

JD = """Acme Corp builds cloud logistics software for global shippers.

Requirements:
- Three or more years of professional experience with Python and SQL.
- Hands-on experience building ETL pipelines with Airflow in production.
- Experience designing and analyzing A/B tests and experiments at scale.
"""

RESUME = """Jane Smith is a data engineer with four years of professional experience.
She built ETL pipelines in Airflow processing two terabytes of data daily.
"""

# Unit-ish 3-D vectors chosen so each requirement's best cosine lands in a known band.
# The two resume sentences sit on the x and y axes; a requirement's z-component is
# "content the resume doesn't have", which is what pushes it out of the covered band.
COVERED_REQ = [0.95, 0.1, 0.29]   # best cosine ≈ 0.95 vs sentence 0
PARTIAL_REQ = [0.42, 0.1, 0.90]   # best cosine ≈ 0.42 vs sentence 0
MISSING_REQ = [0.10, 0.05, 0.99]  # best cosine ≈ 0.10 vs sentence 0


@pytest.fixture
def banded_model():
    """Scripted encoder giving exactly one covered, one partial, one missing requirement."""
    reqs = extract_requirements(JD)
    sents = split_sentences(RESUME)
    assert len(reqs) == 3 and len(sents) == 2, "fixture texts changed — rebuild the vectors"

    vectors = {sents[0]: [1.0, 0.0, 0.0], sents[1]: [0.0, 1.0, 0.0]}
    vectors[reqs[0]] = COVERED_REQ
    vectors[reqs[1]] = PARTIAL_REQ
    vectors[reqs[2]] = MISSING_REQ
    return ScriptedEncoder(vectors), reqs, sents


class TestAnalyzeSkillGap:
    def test_bands_each_requirement_by_its_best_resume_sentence(self, banded_model):
        model, reqs, _ = banded_model

        matches, _ = analyze_skill_gap(model, RESUME, JD)

        assert [m.status for m in matches] == ["covered", "partial", "missing"]
        assert [m.requirement for m in matches] == reqs

    def test_covered_requirement_cites_the_closest_sentence_as_evidence(self, banded_model):
        model, _, sents = banded_model

        matches, _ = analyze_skill_gap(model, RESUME, JD)

        assert matches[0].evidence == sents[0]
        assert matches[0].similarity == pytest.approx(0.95, abs=0.01)

    def test_missing_requirement_has_no_evidence(self, banded_model):
        model, _, _ = banded_model

        matches, _ = analyze_skill_gap(model, RESUME, JD)

        assert matches[2].evidence == ""
        assert matches[2].similarity < PARTIAL_THRESHOLD

    def test_coverage_counts_partial_as_half(self, banded_model):
        model, _, _ = banded_model

        _, coverage = analyze_skill_gap(model, RESUME, JD)

        assert coverage == pytest.approx((1 + 0.5) / 3)  # covered + half a partial, over 3 reqs

    def test_respects_max_requirements(self, banded_model):
        model, _, _ = banded_model

        matches, _ = analyze_skill_gap(model, RESUME, JD, max_requirements=2)

        assert len(matches) == 2

    def test_no_extractable_requirements_returns_empty(self):
        model = ScriptedEncoder({}, default=[1.0, 0.0, 0.0])

        assert analyze_skill_gap(model, RESUME, "") == ([], 0.0)

    def test_empty_resume_returns_empty(self):
        model = ScriptedEncoder({}, default=[1.0, 0.0, 0.0])

        assert analyze_skill_gap(model, "", JD) == ([], 0.0)

    def test_thresholds_are_ordered(self):
        assert 0.0 < PARTIAL_THRESHOLD < COVERED_THRESHOLD < 1.0


class TestVerdictBand:
    @pytest.mark.parametrize("score,expected", [
        (1.00, "Strong match"),
        (0.70, "Strong match"),   # boundary
        (0.699, "Good match"),
        (0.50, "Good match"),     # boundary
        (0.499, "Partial match"),
        (0.30, "Partial match"),  # boundary
        (0.299, "Weak match"),
        (0.15, "Weak match"),     # boundary
        (0.149, "Not a match"),
        (0.00, "Not a match"),
    ])
    def test_bands(self, score, expected):
        assert verdict_band(score)[0] == expected

    def test_every_band_has_an_icon(self):
        icons = {verdict_band(s)[1] for s in (0.9, 0.6, 0.4, 0.2, 0.05)}
        assert len(icons) == 5
