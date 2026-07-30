"""Tests for the demo data pipeline, and specifically for its rejection guard.

The guard is the last thing standing between a mismatched model and the demo page. It exists
because a wrong checkpoint does not raise: it produces real numbers from the wrong weights,
and every downstream consumer renders them happily. That failure has already happened twice
in this project, so the guard is tested rather than trusted.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "build_demo_data", REPO_ROOT / "scripts" / "build_demo_data.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_demo_data"] = module
    spec.loader.exec_module(module)
    return module


bdd = _load_module()


# ── Metric helpers ────────────────────────────────────────────────────────────

def test_spearman_mae_matches_scipy_on_a_monotone_pair():
    truth = [0.1, 0.3, 0.5, 0.7, 0.9]
    pred = [0.15, 0.28, 0.55, 0.68, 0.95]
    sp, mae = bdd.spearman_mae(truth, pred)
    assert sp == pytest.approx(1.0)
    assert mae == pytest.approx(0.038, abs=1e-3)


def test_spearman_mae_returns_none_for_constant_predictions():
    """A model that emits the same value for every pair has no ranking ability. Reporting
    that as a number would be worse than reporting nothing."""
    sp, mae = bdd.spearman_mae([0.1, 0.5, 0.9], [0.5, 0.5, 0.5])
    assert sp is None and mae is None


def test_spearman_mae_returns_none_below_three_points():
    assert bdd.spearman_mae([0.1, 0.9], [0.2, 0.8]) == (None, None)


def test_bootstrap_ci_brackets_the_point_estimate():
    truth = [i / 20 for i in range(20)]
    pred = [min(1.0, t + 0.05) for t in truth]
    ci = bdd.bootstrap_ci(truth, pred, n=200, seed=42)
    assert ci is not None
    lo, hi = ci
    assert lo <= 1.0 <= hi + 1e-9
    assert lo <= hi


def test_bootstrap_ci_is_deterministic_for_a_fixed_seed():
    truth = [i / 20 for i in range(20)]
    pred = [1 - t for t in truth]
    assert bdd.bootstrap_ci(truth, pred, n=200, seed=7) == bdd.bootstrap_ci(truth, pred, n=200, seed=7)


# ── The rejection guard ───────────────────────────────────────────────────────

def _fixture_repo(tmp_path: Path, reported_spearman: float) -> Path:
    """A miniature repo: 6 external pairs, plus a demo_pairs.json whose fine-tuned
    predictions perfectly track the labels (raw Spearman 1.0 by construction)."""
    (tmp_path / "Data").mkdir(parents=True, exist_ok=True)
    (tmp_path / "Results").mkdir(parents=True, exist_ok=True)
    (tmp_path / "web" / "public").mkdir(parents=True, exist_ok=True)

    rows = []
    for i in range(6):
        rows.append({
            "id": i,
            "resume": f"resume {i}",
            "jd": f"posting {i % 3}",
            "score": 0.1 + i * 0.15,
            "match_type": "strong" if i % 2 else "weak",
            "industry": "Cybersecurity",
            "jd_level": "mid",
            "jd_position": "Analyst",
        })
    pd.DataFrame(rows).to_csv(tmp_path / "Data" / "external_test_200_pairs.csv", index=False)

    # The split is stratified on match_type, so whichever half lands in the test set has
    # predictions that rank perfectly against their labels.
    pairs = [{
        "id": r["id"],
        "preds": {
            "finetuned_raw": r["score"],
            "finetuned_calibrated": r["score"],
            "base_mpnet": r["score"] * 0.5,
            "tfidf": r["score"] * 0.3,
        },
    } for r in rows]
    (tmp_path / "Results" / "demo_pairs.json").write_text(
        json.dumps({"model_id": "test/model", "pairs": pairs}), encoding="utf-8")

    (tmp_path / "Results" / "production_results.json").write_text(
        json.dumps({"production": {"raw": {"spearman": reported_spearman}}}), encoding="utf-8")

    return tmp_path


def _run_against(tmp_path: Path, monkeypatch) -> dict:
    monkeypatch.setattr(bdd, "REPO", tmp_path)
    monkeypatch.setattr(bdd, "OUT", tmp_path / "web" / "public" / "benchmark.json")
    for engine in bdd.ENGINES:
        engine.pop("available", None)
    bdd.main()
    return json.loads((tmp_path / "web" / "public" / "benchmark.json").read_text(encoding="utf-8"))


def test_accepts_predictions_that_match_the_reported_metrics(tmp_path, monkeypatch):
    bundle = _run_against(_fixture_repo(tmp_path, reported_spearman=1.0), monkeypatch)

    available = {e["id"] for e in bundle["engines"] if e.get("available")}
    assert "finetuned_calibrated" in available
    assert "finetuned_raw" in available
    assert any("Verified" in note for note in bundle["meta"]["notes"])


def test_rejects_predictions_from_a_different_checkpoint(tmp_path, monkeypatch):
    """The real failure: notebook 06 audits whatever the Hub serves. If that is not what
    notebook 05 measured, the numbers are real and about the wrong model."""
    bundle = _run_against(_fixture_repo(tmp_path, reported_spearman=0.72), monkeypatch)

    available = {e["id"] for e in bundle["engines"] if e.get("available")}
    assert "finetuned_calibrated" not in available
    assert "finetuned_raw" not in available
    assert bundle["audit"] is None, "audit findings derive from the rejected model"
    assert any("REJECTED" in note for note in bundle["meta"]["notes"])


def test_rejection_keeps_engines_that_do_not_depend_on_the_published_model(tmp_path, monkeypatch):
    """TF-IDF and base MPNet involve no fine-tuned weights, so a mismatch says nothing about
    them. Throwing them away would lose the only baselines the page has."""
    bundle = _run_against(_fixture_repo(tmp_path, reported_spearman=0.72), monkeypatch)

    available = {e["id"] for e in bundle["engines"] if e.get("available")}
    assert {"base_mpnet", "tfidf"} <= available


def test_tolerance_absorbs_float_noise_but_not_a_real_difference(tmp_path, monkeypatch):
    # 0.005 apart: same model, different hardware or library build.
    accepted = _run_against(_fixture_repo(tmp_path / "near", reported_spearman=0.995), monkeypatch)
    assert any(e["id"] == "finetuned_raw" and e.get("available") for e in accepted["engines"])

    for engine in bdd.ENGINES:
        engine.pop("available", None)

    # 0.02 apart: different weights.
    rejected = _run_against(_fixture_repo(tmp_path / "far", reported_spearman=0.98), monkeypatch)
    assert not any(e["id"] == "finetuned_raw" and e.get("available") for e in rejected["engines"])


def test_bundle_omits_mae_for_non_calibrated_baselines(tmp_path, monkeypatch):
    """TF-IDF cosine is a similarity in its own units, not an estimate of the 0-1 label.
    An absolute error against that label would be a meaningless number presented as a
    comparable one."""
    bundle = _run_against(_fixture_repo(tmp_path, reported_spearman=1.0), monkeypatch)
    assert bundle["metrics"]["tfidf"]["mae"] is None
    assert "mae_note" in bundle["metrics"]["tfidf"]
