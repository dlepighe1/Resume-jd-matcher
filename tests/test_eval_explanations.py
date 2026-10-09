"""Tests for the skill-gap explanation evaluation.

The evaluation exists to stop `app/explain.py` shipping constants nobody measured. These
tests exist to stop the evaluation itself from measuring the wrong thing, which is the
failure that would be hardest to notice: every number it prints would still look plausible.

Offline like the rest of the suite. The real run needs the published checkpoint, so what is
tested here is the arithmetic and the discipline around it, on data whose answer is known.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "eval_explanations", REPO_ROOT / "scripts" / "eval_explanations.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["eval_explanations"] = module
    spec.loader.exec_module(module)
    return module


ev = _load_module()


# ── The coverage formula matches the one that ships ───────────────────────────

def test_coverage_matches_what_analyze_skill_gap_computes():
    """The load-bearing property. `coverage_at` recomputes coverage from cached
    similarities so the threshold sweep does not re-encode 212 pairs per grid point. If it
    drifts from app/explain.py, every number in the evaluation describes a coverage measure
    the product does not compute, and nothing anywhere would fail."""
    from conftest import ScriptedEncoder

    from app.explain import COVERED_THRESHOLD, PARTIAL_THRESHOLD, analyze_skill_gap
    from src.text_utils import extract_requirements, split_sentences

    jd = """Acme builds logistics software.

    Requirements:
    - Three or more years of professional experience with Python and SQL.
    - Hands-on experience building ETL pipelines with Airflow in production.
    - Experience designing and analyzing A/B tests at scale.
    """
    resume = ("Jane is a data engineer with four years of experience.\n"
              "She built ETL pipelines in Airflow processing terabytes daily.\n")

    reqs = extract_requirements(jd)
    sents = split_sentences(resume)
    def unit(c):
        return [c, 0.0, float((1 - c**2) ** 0.5)]

    targets = [(COVERED_THRESHOLD + 1) / 2,
               (COVERED_THRESHOLD + PARTIAL_THRESHOLD) / 2,
               PARTIAL_THRESHOLD / 2]

    vectors = {sents[0]: [1.0, 0.0, 0.0], sents[1]: [0.0, 1.0, 0.0]}
    for req, target in zip(reqs, targets, strict=False):
        vectors[req] = unit(target)

    matches, shipped_coverage = analyze_skill_gap(ScriptedEncoder(vectors), resume, jd)
    recomputed = ev.coverage_at([m.similarity for m in matches],
                                COVERED_THRESHOLD, PARTIAL_THRESHOLD)

    assert recomputed == pytest.approx(shipped_coverage)


@pytest.mark.parametrize("sims,covered,partial,expected", [
    ([0.9, 0.9], 0.65, 0.55, 1.0),            # both covered
    ([0.1, 0.1], 0.65, 0.55, 0.0),            # both missing
    ([0.6, 0.6], 0.65, 0.55, 0.5),            # both partial, each worth a half
    ([0.9, 0.6, 0.1], 0.65, 0.55, 0.5),       # one of each, (1 + 0.5 + 0) / 3
])
def test_coverage_bands_and_weights(sims, covered, partial, expected):
    assert ev.coverage_at(sims, covered, partial) == pytest.approx(expected)


def test_coverage_of_a_posting_with_no_extractable_requirements_is_zero():
    assert ev.coverage_at([], 0.65, 0.55) == 0.0


def test_a_similarity_exactly_on_a_threshold_takes_the_higher_band():
    """Matches the `>=` in app/explain.py. A boundary that disagreed would move a handful
    of requirements per run and be invisible in any aggregate."""
    assert ev.coverage_at([0.65], 0.65, 0.55) == 1.0
    assert ev.coverage_at([0.55], 0.65, 0.55) == 0.5


# ── Rank separation ───────────────────────────────────────────────────────────

def test_rank_separation_is_one_when_positives_all_cover_more():
    coverage = np.array([0.9, 0.8, 0.2, 0.1])
    positive = np.array([True, True, False, False])
    assert ev.rank_separation(coverage, positive) == 1.0


def test_rank_separation_is_a_half_when_the_measure_is_uninformative():
    """0.5 is the coin flip, not zero. Reporting an AUC without saying so invites reading
    0.6 as poor when it is a real effect."""
    coverage = np.array([0.5, 0.5, 0.5, 0.5])
    positive = np.array([True, True, False, False])
    assert ev.rank_separation(coverage, positive) == 0.5


def test_rank_separation_counts_ties_as_half():
    coverage = np.array([0.5, 0.9, 0.5, 0.1])
    positive = np.array([True, True, False, False])
    # positives {0.5, 0.9} vs negatives {0.5, 0.1}: wins 0.5+1+1+1 out of 4
    assert ev.rank_separation(coverage, positive) == pytest.approx(0.875)


def test_rank_separation_is_undefined_rather_than_zero_without_both_classes():
    coverage = np.array([0.9, 0.8])
    assert np.isnan(ev.rank_separation(coverage, np.array([True, True])))


# ── The split is the study's split ────────────────────────────────────────────

def test_the_split_is_the_one_src_train_produces():
    """`final test` has to mean the same 106 pairs the score is reported on. A fresh split
    would produce numbers that look comparable to the published ones and are not."""
    import pandas as pd
    from sklearn.model_selection import train_test_split

    from src.train import SEED

    external = pd.read_csv(REPO_ROOT / "Data" / "external_test_200_pairs.csv")
    expected_cal, expected_test = train_test_split(
        external, test_size=0.5, random_state=SEED, stratify=external["match_type"])

    cal, test = ev.load_splits()
    assert list(cal["id"]) == list(expected_cal["id"])
    assert list(test["id"]) == list(expected_test["id"])
    assert not set(cal["id"]) & set(test["id"])


def test_the_two_halves_are_the_expected_size():
    cal, test = ev.load_splits()
    assert len(cal) == len(test) == 106


# ── Threshold selection happens on the calibration half only ──────────────────

def test_the_sweep_never_proposes_a_partial_above_its_covered_threshold():
    """A partial band above the covered one is not a conservative choice, it is an
    incoherent one: every partial requirement would also be covered."""
    import pandas as pd

    rng = np.random.default_rng(0)
    frame = pd.DataFrame({"match_type": ["strong", "weak"] * 10})
    sims = [list(rng.uniform(0, 1, 5)) for _ in range(20)]

    best = ev.sweep_thresholds(sims, frame)
    assert best["partial"] < best["covered"]


def test_the_sweep_finds_a_threshold_that_separates_by_construction():
    """Positives sit just above 0.6 and negatives just below it, so a grid containing 0.6
    must be able to separate them perfectly."""
    import pandas as pd

    frame = pd.DataFrame({"match_type": ["strong"] * 10 + ["weak"] * 10})
    sims = [[0.62] * 4 for _ in range(10)] + [[0.58] * 4 for _ in range(10)]

    best = ev.sweep_thresholds(sims, frame)
    assert best["auc"] == 1.0
    assert best["covered"] == pytest.approx(0.60)


def test_the_grid_stays_inside_the_range_real_similarities_occupy():
    """Below 0.2 every requirement is covered because any two English documents share a
    cosine floor; above 0.75 nothing in the external set reaches."""
    assert min(ev.SWEEP) >= 0.2
    assert max(ev.SWEEP) <= 0.75


# ── The bootstrap resamples postings ──────────────────────────────────────────

def test_the_bootstrap_resamples_postings_not_pairs():
    """Same property tests/test_significance.py guards for the engine comparisons.
    Duplicating every pair inside its posting must not look like twice the evidence."""
    rng_a, rng_b = np.random.default_rng(4), np.random.default_rng(4)
    values = np.arange(20, dtype=float)
    postings = np.array([f"p{i}" for i in range(10)] * 2)

    single = ev.cluster_bootstrap(lambda idx: float(values[idx].mean()),
                                  postings[:10], 600, rng_a)
    doubled = ev.cluster_bootstrap(lambda idx: float(values[idx % 10].mean()),
                                   postings, 600, rng_b)

    def width(o):
        return o["ci95"][1] - o["ci95"][0]

    assert width(doubled) == pytest.approx(width(single), abs=0.6)


# ── The committed artifact justifies the constants that ship ──────────────────

def test_the_shipped_thresholds_are_the_ones_the_evaluation_reported():
    """app/explain.py's constants used to be hand-picked with a comment for a rationale.
    They now have a measurement behind them, and this is what stops them drifting away from
    it. Changing either constant without re-running the evaluation fails here."""
    from app.explain import COVERED_THRESHOLD, PARTIAL_THRESHOLD

    path = REPO_ROOT / "Results" / "explanation_eval.json"
    if not path.exists():
        pytest.skip("explanation_eval.json has not been generated")
    reported = json.loads(path.read_text(encoding="utf-8"))["shipped_thresholds"]["thresholds"]

    assert reported["covered"] == pytest.approx(COVERED_THRESHOLD)
    assert reported["partial"] == pytest.approx(PARTIAL_THRESHOLD)


def test_the_shipped_thresholds_are_not_beaten_by_retuning():
    """The conclusion this artifact supports: the constants that ship are the ones the
    sweep chose, so retuning has nothing left to find. If a re-run says otherwise, the
    thresholds are stale and app/explain.py has to be updated rather than left alone."""
    path = REPO_ROOT / "Results" / "explanation_eval.json"
    if not path.exists():
        pytest.skip("explanation_eval.json has not been generated")
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert not payload["retuning_gain_on_final_test"]["significant"], (
        "tuned thresholds now beat the shipped ones on held-out data; update "
        "app/explain.py's constants to the values in threshold_selection.best"
    )


def test_the_explanation_carries_signal_at_all():
    """The question that decides whether the coverage number is worth showing. If its
    correlation with the match label can no longer be separated from zero, the product is
    displaying a decoration."""
    path = REPO_ROOT / "Results" / "explanation_eval.json"
    if not path.exists():
        pytest.skip("explanation_eval.json has not been generated")
    shipped = json.loads(path.read_text(encoding="utf-8"))["shipped_thresholds"]

    assert shipped["spearman_ci95"][0] > 0, (
        "coverage is no longer measurably correlated with the match label"
    )
    assert shipped["auc_ci95"][0] > 0.5, (
        "coverage no longer separates good matches from bad ones better than a coin flip"
    )
