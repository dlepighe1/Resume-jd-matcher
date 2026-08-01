"""Assert that every published number still matches the artifact it was copied from.

Results/results_summary.json is hand-maintained prose-plus-numbers, which makes it the file
most likely to drift. It has drifted before: after two production re-runs it still advertised
0.8355 Spearman and 94.3% precision@1, and scripts/calibrate.py still had 0.8645 typed into
it as a literal. Nothing failed, because a stale number looks exactly like a fresh one.

These tests compare the summary against the machine-written artifacts. They are the reason
the summary can be trusted without re-reading the notebooks.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from scipy.stats import spearmanr

REPO_ROOT = Path(__file__).resolve().parents[1]
RESULTS = REPO_ROOT / "Results"


def _load(name: str):
    path = RESULTS / name
    if not path.exists():
        pytest.skip(f"{name} has not been generated")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def summary():
    return _load("results_summary.json")


@pytest.fixture(scope="module")
def production():
    return _load("production_results.json")


@pytest.fixture(scope="module")
def audit():
    return _load("audit_results.json")


@pytest.fixture(scope="module")
def significance():
    return _load("significance.json")


@pytest.fixture(scope="module")
def demo_pairs():
    return _load("demo_pairs.json")


# ── The published checkpoint is the measured checkpoint ───────────────────────

def test_production_run_was_verified_against_the_hub(production):
    """The single defect that cost this project two full re-runs. fit() saves the
    best-by-validation checkpoint while leaving the final epoch in memory, so it is possible
    to publish one model and report another. The export cell now proves they match."""
    assert production.get("published_verified") is True, (
        "production_results.json does not record a successful publication check. "
        "Run notebook 05's export cell against the published model."
    )


def test_audit_measured_the_same_model_the_production_run_reported(audit, production):
    reported = production["production"]["platt"]
    assert audit["production"]["spearman"] == pytest.approx(reported["spearman"], abs=0.01)
    assert audit["production"]["mae"] == pytest.approx(reported["mae"], abs=0.01)


def test_demo_pairs_reproduce_the_reported_metrics(demo_pairs, production):
    """The per-pair export is what the demo page renders. If it disagrees with the report,
    the page is showing a different model from the one the study describes."""
    true = np.array([p["true"] for p in demo_pairs["pairs"]])
    for column, key in (("finetuned_raw", "raw"), ("finetuned_calibrated", "platt")):
        pred = np.array([p["preds"][column] for p in demo_pairs["pairs"]])
        rho = float(spearmanr(true, pred)[0])
        mae = float(np.mean(np.abs(true - pred)))
        # Predictions are stored rounded to 4 places, which can swap two near-tied ranks.
        assert rho == pytest.approx(production["production"][key]["spearman"], abs=0.005)
        assert mae == pytest.approx(production["production"][key]["mae"], abs=0.005)


# ── The summary matches the artifacts ─────────────────────────────────────────

def test_summary_production_numbers_match_production_results(summary, production):
    s = summary["notebook_05_production"]
    p = production

    assert s["production_seed"] == p["production_seed"]
    for calibrator in ("raw", "platt", "isotonic"):
        assert s["production_MPNet_plus_platt"][calibrator] == p["production"][calibrator], (
            f"summary disagrees with production_results.json on the {calibrator} numbers"
        )
    assert s["aggregate"] == p["aggregate"]
    assert s["baseline_base_mpnet"] == p["baseline_base_mpnet"]
    assert s["cross_encoder_distilroberta"] == p["cross_encoder_distilroberta"]


def test_summary_per_seed_matches_production_results(summary, production):
    by_seed = {str(r["seed"]): r for r in production["per_seed"]}
    for seed, reported in summary["notebook_05_production"]["per_seed_platt"].items():
        assert reported == by_seed[seed]["platt"]


def test_summary_precision_at_1_matches_production_results(summary, production):
    s = summary["notebook_05_production"]["precision_at_1"]
    r = production["ranking"]
    assert (s["hits"], s["groups"]) == (r["hits"], r["groups"])
    assert s["precision_at_1"] == pytest.approx(r["precision_at_1"])


def test_summary_baseline_ladder_matches_the_audit(summary, audit):
    ladder = summary["audit"]["baseline_ladder"]
    for key, audit_key in (("jaccard", "jaccard"), ("tfidf", "tfidf"),
                           ("base_mpnet", "base_mpnet"), ("finetuned_platt", "production")):
        assert ladder[key]["spearman"] == pytest.approx(audit[audit_key]["spearman"], abs=1e-4)


def test_summary_audit_findings_match_the_audit_artifact(summary, audit):
    s = summary["audit"]
    assert s["name_bias"]["group_mean_spread"] == audit["name_bias"]["group_mean_spread"]
    assert s["name_bias"]["verdict_flips"] == audit["name_bias"]["verdict_flips"]
    assert s["calibration"]["ece"] == audit["calibration"]["ece"]
    for match_type, values in audit["by_match_type"].items():
        assert s["by_match_type"][match_type] == values


def test_summary_significance_matches_the_significance_artifact(summary, significance):
    by_pair = {(c["b"], c["metric"]): c for c in significance["comparisons"]}
    mapping = {
        "production_vs_base_mpnet": "base_mpnet",
        "production_vs_claude_opus_4_5": "claude",
        "production_vs_tfidf": "tfidf",
        "production_vs_jaccard": "jaccard",
    }
    for summary_key, engine in mapping.items():
        computed = by_pair[(engine, "spearman")]
        claimed = summary["significance"][summary_key]
        assert claimed["spearman_diff"] == pytest.approx(computed["difference"], abs=1e-4)
        assert claimed["significant"] == computed["significant"]


# ── No stale hardcoded metrics ────────────────────────────────────────────────

def test_claude_comparison_file_cites_the_current_finetuned_numbers(production):
    """This file once carried finetuned_mpnet 0.8645 / 0.1021, from a run two generations
    old, because the value was a literal in scripts/calibrate.py rather than a lookup."""
    path = RESULTS / "claude_benchmark_calibrated.json"
    if not path.exists():
        pytest.skip("claude_benchmark_calibrated.json has not been generated")
    cited = json.loads(path.read_text(encoding="utf-8"))["finetuned_mpnet"]
    reported = production["production"]["platt"]
    assert cited["spearman"] == pytest.approx(reported["spearman"], abs=1e-4)
    assert cited["mae"] == pytest.approx(reported["mae"], abs=1e-4)


def test_calibrator_choice_is_recorded_as_a_tie_not_a_win(summary, production):
    """Platt ships because a 2-parameter sigmoid cannot overfit a 106-pair calibration
    split, not because it beat isotonic. If a future run makes that a real difference, this
    test fails and the justification has to be rewritten rather than silently inherited."""
    assert summary["notebook_05_production"]["calibrator_bootstrap"]["verdict"] == \
        production["calibrator_bootstrap"]["verdict"]
    lo, hi = production["calibrator_bootstrap"]["ci95"]
    assert lo <= 0 <= hi, "the calibrators are now distinguishable; update the rationale"
