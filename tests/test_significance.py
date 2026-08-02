"""Tests for the significance analysis.

The point of scripts/significance.py is to stop the project claiming a difference that
resampling would not support. A bug here does not crash anything, it just quietly turns a
coin flip into a headline, so the statistics are tested against closed-form references and
against data whose answer is known by construction.
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
        "significance", REPO_ROOT / "scripts" / "significance.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["significance"] = module
    spec.loader.exec_module(module)
    return module


sig = _load_module()


def _pairs(rows):
    """rows: (posting, true, pred_a, pred_b) -> the shape load_pairs returns."""
    return [
        {"id": i, "true": t, "posting": post, "match_type": "strong",
         "preds": {"a": a, "b": b, "finetuned_raw": a, "finetuned_calibrated": a}}
        for i, (post, t, a, b) in enumerate(rows)
    ]


# ── Wilson interval ───────────────────────────────────────────────────────────
# Checked against the published closed-form values, not against another call of the
# same code.

@pytest.mark.parametrize("hits,n,expected", [
    (5, 10, [0.2366, 0.7634]),
    (0, 10, [0.0, 0.2775]),
    (10, 10, [0.7225, 1.0]),
])
def test_wilson_matches_reference_values(hits, n, expected):
    assert sig.wilson(hits, n) == pytest.approx(expected, abs=1e-4)


def test_wilson_stays_inside_the_unit_interval_at_the_boundary():
    """The normal approximation returns negative lower bounds for extreme proportions.
    Reporting a precision@1 interval of [-0.05, 0.20] would be visibly wrong on a page
    aimed at recruiters."""
    for hits, n in [(0, 5), (5, 5), (1, 60), (59, 60)]:
        lo, hi = sig.wilson(hits, n)
        assert 0.0 <= lo <= hi <= 1.0


def test_wilson_handles_an_empty_sample():
    assert sig.wilson(0, 0) == [0.0, 0.0]


def test_wilson_narrows_as_the_sample_grows():
    width = lambda h, n: sig.wilson(h, n)[1] - sig.wilson(h, n)[0]
    assert width(45, 53) > width(450, 530) > width(4500, 5300)


# ── Paired cluster bootstrap ──────────────────────────────────────────────────

def test_identical_engines_produce_no_difference():
    pairs = _pairs([(f"p{i//2}", i / 10, i / 10, i / 10) for i in range(10)])
    rng = np.random.default_rng(0)
    out = sig.cluster_bootstrap(pairs, "a", "b", "spearman", 300, rng)

    assert out["difference"] == 0.0
    assert out["ci95"] == [0.0, 0.0]
    assert not out["significant"]
    assert out["p_value"] == pytest.approx(1.0)


def test_a_clearly_better_engine_is_flagged_significant():
    # `a` tracks the label, `b` inverts it.
    rows = [(f"p{i // 2}", i / 20, i / 20, 1 - i / 20) for i in range(20)]
    rng = np.random.default_rng(0)
    out = sig.cluster_bootstrap(_pairs(rows), "a", "b", "spearman", 500, rng)

    assert out["difference"] == pytest.approx(2.0, abs=1e-6)
    assert out["significant"]
    assert out["ci95"][0] > 0


def test_resampling_unit_is_the_posting_not_the_pair():
    """The load-bearing property. If this resampled pairs, duplicating every pair within
    its posting would look like twice as much evidence and shrink the interval. Because
    postings are the unit, replication inside a posting adds nothing."""
    base = [(f"p{i}", i / 10, i / 10 + 0.02, 1 - i / 10) for i in range(10)]
    duplicated = base + base  # same 10 postings, two identical pairs each

    a = sig.cluster_bootstrap(_pairs(base), "a", "b", "spearman", 800,
                              np.random.default_rng(3))
    b = sig.cluster_bootstrap(_pairs(duplicated), "a", "b", "spearman", 800,
                              np.random.default_rng(3))

    width = lambda o: o["ci95"][1] - o["ci95"][0]
    assert width(b) == pytest.approx(width(a), abs=0.05)


def test_a_single_posting_yields_a_degenerate_interval():
    """One cluster means every resample is the same data, so there is no variance to
    estimate. The interval should collapse rather than imply precision."""
    rows = [("only-posting", i / 10, i / 10, 1 - i / 10) for i in range(8)]
    out = sig.cluster_bootstrap(_pairs(rows), "a", "b", "spearman", 200,
                                np.random.default_rng(1))
    assert out["ci95"][0] == pytest.approx(out["ci95"][1])


def test_bootstrap_is_deterministic_for_a_fixed_seed():
    rows = [(f"p{i // 3}", i / 15, i / 15 + 0.03, 0.5) for i in range(15)]
    first = sig.cluster_bootstrap(_pairs(rows), "a", "b", "mae", 300, np.random.default_rng(11))
    second = sig.cluster_bootstrap(_pairs(rows), "a", "b", "mae", 300, np.random.default_rng(11))
    assert first == second


def test_degenerate_resamples_are_dropped_rather_than_poisoning_the_estimate():
    """Spearman is undefined when a resample draws a constant column. Those draws must be
    discarded; letting a nan through makes the percentiles nan and the CI unreadable."""
    rows = [(f"p{i}", 0.5 if i < 2 else i / 10, i / 10, 1 - i / 10) for i in range(4)]
    out = sig.cluster_bootstrap(_pairs(rows), "a", "b", "spearman", 400,
                                np.random.default_rng(5))
    assert np.isfinite(out["ci95"]).all()
    assert out["n_effective_resamples"] > 0


# ── Which metrics are allowed for which engine ────────────────────────────────

def test_mae_is_not_offered_for_engines_whose_scores_are_not_label_estimates():
    """TF-IDF and Jaccard similarities live on their own scale. An MAE against a 0-1 label
    would measure the scale gap and read as if the method were bad."""
    assert "tfidf" not in sig.MAE_COMPARABLE
    assert "jaccard" not in sig.MAE_COMPARABLE
    assert {"base_mpnet", "claude"} <= sig.MAE_COMPARABLE


# ── Leave-one-posting-out calibration ─────────────────────────────────────────

def test_leave_one_posting_out_recovers_a_learnable_mapping():
    """When the raw-to-label mapping is a clean sigmoid shared across postings, holding a
    posting out costs almost nothing, so the honest MAE should stay small."""
    rng = np.random.default_rng(0)
    raw = rng.uniform(-2, 2, 40)
    true = 1 / (1 + np.exp(-(1.5 * raw + 0.2)))
    rows = [(f"p{i // 2}", float(true[i]), float(raw[i]), 0.0) for i in range(40)]
    pairs = _pairs(rows)
    for p in pairs:  # the reported column is what LOPO is compared against
        p["preds"]["finetuned_calibrated"] = p["preds"]["finetuned_raw"]

    out = sig.leave_one_posting_out(pairs)
    assert out["postings_held_out"] == 20
    assert out["leave_one_posting_out_mae"] < 0.05


def test_leave_one_posting_out_skips_when_raw_scores_are_absent():
    pairs = _pairs([(f"p{i}", i / 5, i / 5, 0.0) for i in range(5)])
    for p in pairs:
        del p["preds"]["finetuned_raw"]
    assert "skipped" in sig.leave_one_posting_out(pairs)


# ── Joining Claude predictions ────────────────────────────────────────────────

def test_load_pairs_refuses_a_join_whose_labels_disagree(tmp_path, monkeypatch):
    """Both files carry the label. If they differ, the id means something different in each
    file and every Claude comparison would silently describe mismatched pairs."""
    results = tmp_path / "Results"
    results.mkdir(parents=True)
    (results / "demo_pairs.json").write_text(json.dumps({"pairs": [
        {"id": 1, "true": 0.4, "jd": "posting", "match_type": "weak",
         "preds": {"finetuned_calibrated": 0.4, "finetuned_raw": 0.4}}
    ]}), encoding="utf-8")
    (results / "claude_benchmark_predictions.jsonl").write_text(
        json.dumps({"id": 1, "claude_pred": 0.5, "label": 0.9}) + "\n", encoding="utf-8")

    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "demo_pairs.json")
    monkeypatch.setattr(sig, "CLAUDE_PREDS", results / "claude_benchmark_predictions.jsonl")

    with pytest.raises(SystemExit, match="Label mismatch"):
        sig.load_pairs()


def test_load_pairs_ignores_claude_rows_that_errored(tmp_path, monkeypatch):
    """The prediction file keeps 429 failures from an abandoned run alongside real rows."""
    results = tmp_path / "Results"
    results.mkdir(parents=True)
    (results / "demo_pairs.json").write_text(json.dumps({"pairs": [
        {"id": 1, "true": 0.4, "jd": "posting", "match_type": "weak",
         "preds": {"finetuned_calibrated": 0.4, "finetuned_raw": 0.4}}
    ]}), encoding="utf-8")
    (results / "claude_benchmark_predictions.jsonl").write_text(
        json.dumps({"id": 2, "error": "RateLimitError"}) + "\n"
        + json.dumps({"id": 1, "claude_pred": 0.5, "label": 0.4}) + "\n", encoding="utf-8")

    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "demo_pairs.json")
    monkeypatch.setattr(sig, "CLAUDE_PREDS", results / "claude_benchmark_predictions.jsonl")

    pairs = sig.load_pairs()
    assert pairs[0]["preds"]["claude"] == 0.5


# ── The loss ablation ─────────────────────────────────────────────────────────
# Exercised on synthetic data so the whole path is known to work before anyone spends four
# GPU hours producing the real input.

def _ablation_fixture(tmp_path, ids=None, arms=("cosent", "cosine", "combined")):
    results = tmp_path / "Results"
    results.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    ids = list(range(24)) if ids is None else ids
    pairs = []
    for k, i in enumerate(ids):
        true = round(float((k % 8) / 8), 4)
        preds = {}
        for arm in arms:
            # `combined` tracks the label closely, the others progressively less so.
            noise = {"combined": 0.02, "cosent": 0.05, "cosine": 0.25}.get(arm, 0.1)
            v = float(np.clip(true + rng.normal(0, noise), 0, 1))
            preds[f"{arm}_raw"] = round(v, 4)
            preds[f"{arm}_platt"] = round(v, 4)
        pairs.append({"id": i, "true": true, "jd": f"posting-{k // 2}",
                      "match_type": "strong", "preds": preds})
    (results / "loss_ablation.json").write_text(
        json.dumps({"arms": list(arms), "pairs": pairs}), encoding="utf-8")
    return results


def test_ablation_export_loads_and_clusters_by_posting(tmp_path, monkeypatch):
    results = _ablation_fixture(tmp_path)
    monkeypatch.setattr(sig, "ABLATION", results / "loss_ablation.json")
    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "missing.json")

    pairs, arms = sig.load_ablation_pairs()
    assert len(pairs) == 24
    assert arms == ["cosent", "cosine", "combined"]
    assert len({p["posting"] for p in pairs}) == 12
    assert "combined_platt" in pairs[0]["preds"]


def test_ablation_refuses_a_different_test_split(tmp_path, monkeypatch):
    """The ablation is only interpretable against notebook 05 if it ran on the same pairs.
    A different split still produces plausible numbers for a different question."""
    results = _ablation_fixture(tmp_path, ids=list(range(100, 124)))
    (results / "demo_pairs.json").write_text(
        json.dumps({"pairs": [{"id": i} for i in range(24)]}), encoding="utf-8")
    monkeypatch.setattr(sig, "ABLATION", results / "loss_ablation.json")
    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "demo_pairs.json")

    with pytest.raises(SystemExit, match="different test split"):
        sig.load_ablation_pairs()


def test_ablation_accepts_the_matching_split(tmp_path, monkeypatch):
    results = _ablation_fixture(tmp_path)
    (results / "demo_pairs.json").write_text(
        json.dumps({"pairs": [{"id": i} for i in range(24)]}), encoding="utf-8")
    monkeypatch.setattr(sig, "ABLATION", results / "loss_ablation.json")
    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "demo_pairs.json")

    assert len(sig.load_ablation_pairs()[0]) == 24


def test_ablation_end_to_end_writes_a_verdict(tmp_path, monkeypatch):
    results = _ablation_fixture(tmp_path)
    monkeypatch.setattr(sig, "ABLATION", results / "loss_ablation.json")
    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "missing.json")
    monkeypatch.setattr(sig, "REPO", tmp_path)

    out = results / "loss_ablation_significance.json"
    sig.run_ablation(resamples=300, seed=1, out_path=out)

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["reference_arm"] == "combined_platt"
    assert payload["_preregistered_hypothesis"].startswith("H1")
    assert payload["h1_verdict"] is not None
    # combined is by construction the closest to the label, so cosine must be separable.
    cosine = next(c for c in payload["comparisons"]
                  if c["b"] == "cosine_platt" and c["metric"] == "spearman")
    assert cosine["significant"]


def test_ablation_omits_mae_when_one_side_is_uncalibrated(tmp_path, monkeypatch):
    """Raw cosine is not an estimate of the label. An MAE against it would measure the
    missing calibrator rather than the loss under test."""
    results = _ablation_fixture(tmp_path)
    monkeypatch.setattr(sig, "ABLATION", results / "loss_ablation.json")
    monkeypatch.setattr(sig, "DEMO_PAIRS", results / "missing.json")
    monkeypatch.setattr(sig, "REPO", tmp_path)

    out = results / "loss_ablation_significance.json"
    sig.run_ablation(resamples=200, seed=1, out_path=out)
    payload = json.loads(out.read_text(encoding="utf-8"))

    mae_targets = {c["b"] for c in payload["comparisons"] if c["metric"] == "mae"}
    assert all(t.endswith("_platt") for t in mae_targets)
    assert not any(t.endswith("_raw") for t in mae_targets)


# ── The committed artifact ────────────────────────────────────────────────────

def test_committed_significance_matches_the_committed_metrics():
    """Guards against significance.json drifting away from production_results.json the way
    the hardcoded finetuned number in calibrate.py once did."""
    path = REPO_ROOT / "Results" / "significance.json"
    if not path.exists():
        pytest.skip("significance.json not generated yet")
    s = json.loads(path.read_text(encoding="utf-8"))
    prod = json.loads((REPO_ROOT / "Results" / "production_results.json").read_text(encoding="utf-8"))

    assert s["precision_at_1"]["hits"] == prod["ranking"]["hits"]
    assert s["precision_at_1"]["postings"] == prod["ranking"]["groups"]

    lo, hi = s["precision_at_1"]["wilson_ci95"]
    assert lo <= s["precision_at_1"]["precision_at_1"] <= hi
