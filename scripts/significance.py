"""Decide which differences between scoring engines are real.

The study reports point estimates like "0.8163 for the fine-tuned model, 0.7117 for
Claude". On 106 pairs that gap may or may not survive resampling, and a portfolio claim
that it does needs a test rather than a comparison of two decimals.

Three things happen here.

1. PAIRED CLUSTER BOOTSTRAP. Every engine scores the same 106 pairs, so the comparison is
   paired: the same resample is scored by both engines and the difference is recorded.
   Resampling is over POSTINGS, not pairs. The 106 pairs come from 50 job postings with 1
   to 4 pairs each, so pairs sharing a posting are correlated and a pair-level bootstrap
   would treat 106 correlated observations as 106 independent ones and report intervals
   that are too narrow.

2. PRECISION@1 INTERVALS. 45 of 53 postings is a binomial proportion, so it gets a Wilson
   score interval (which behaves near the boundary, unlike the normal approximation) and
   an exact binomial test against the 25% random baseline.

3. LEAVE-ONE-POSTING-OUT CALIBRATION. The 212 external pairs were split into calibration
   and final test stratified by match type, which scattered each posting's four candidates
   across both halves: 47 of the 50 test postings also appear in the calibration split. The
   calibrator never sees text, only scores, and Spearman and precision@1 are invariant to
   any monotone calibration, so the ranking results cannot be affected. MAE can be. This
   refits Platt leaving out one posting at a time, using only test-split pairs, to get an
   MAE estimate where no posting contributed to its own calibrator.

Usage:
    python scripts/significance.py
    python scripts/significance.py --resamples 20000
"""

import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np
from scipy.stats import ConstantInputWarning, binomtest, spearmanr

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.train import PlattCalibrator  # noqa: E402

RESULTS = REPO / "Results"
DEMO_PAIRS = RESULTS / "demo_pairs.json"
CLAUDE_PREDS = RESULTS / "claude_benchmark_predictions.jsonl"
PRODUCTION = RESULTS / "production_results.json"

PRODUCTION_ENGINE = "finetuned_calibrated"

# MAE compares a prediction against a 0-1 label. TF-IDF and Jaccard produce a similarity
# that was never meant to estimate that label, so their MAE measures the scale mismatch
# rather than the method. Rank quality is the only comparable axis for them.
MAE_COMPARABLE = {"finetuned_calibrated", "finetuned_raw", "base_mpnet", "claude"}


def load_pairs() -> list[dict]:
    """The 106 final-test pairs, each carrying every engine's prediction."""
    demo = json.loads(DEMO_PAIRS.read_text(encoding="utf-8"))
    pairs = demo["pairs"]

    claude = {}
    if CLAUDE_PREDS.exists():
        for line in CLAUDE_PREDS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if "claude_pred" in row:  # the rest are rate-limit errors from an earlier run
                claude[row["id"]] = row

    missing = [p["id"] for p in pairs if p["id"] not in claude]
    if claude and missing:
        print(f"note: {len(missing)} of {len(pairs)} pairs have no Claude prediction, "
              f"Claude comparisons will be skipped")

    out = []
    for p in pairs:
        preds = dict(p["preds"])
        row = claude.get(p["id"])
        if row is not None:
            # Guard the join. Labels are carried in both files; if they disagree the two
            # files describe different pairs and every Claude comparison below is garbage.
            if abs(float(row["label"]) - float(p["true"])) > 1e-6:
                raise SystemExit(
                    f"Label mismatch on pair {p['id']}: demo_pairs has {p['true']}, "
                    f"Claude predictions have {row['label']}. The files disagree about "
                    f"which pair this is."
                )
            preds["claude"] = float(row["claude_pred"])
        out.append({
            "id": p["id"],
            "true": float(p["true"]),
            "posting": p["jd"],  # the cluster key
            "match_type": p["match_type"],
            "preds": preds,
        })
    return out


def spearman(true: np.ndarray, pred: np.ndarray) -> float:
    rho, _ = spearmanr(true, pred)
    return float(rho)


def mae(true: np.ndarray, pred: np.ndarray) -> float:
    return float(np.mean(np.abs(true - pred)))


METRICS = {"spearman": spearman, "mae": mae}


def cluster_bootstrap(pairs, engine_a, engine_b, metric, resamples, rng):
    """Resample postings with replacement; score both engines on each resample.

    Returns the observed difference (a - b), the percentile interval, and a two-sided
    bootstrap p-value for the null that the difference is zero.
    """
    fn = METRICS[metric]
    true = np.array([p["true"] for p in pairs])
    a = np.array([p["preds"][engine_a] for p in pairs])
    b = np.array([p["preds"][engine_b] for p in pairs])

    # Group row indices by posting, then resample the groups.
    groups: dict[str, list[int]] = {}
    for i, p in enumerate(pairs):
        groups.setdefault(p["posting"], []).append(i)
    blocks = [np.array(v) for v in groups.values()]

    observed = fn(true, a) - fn(true, b)

    diffs = []
    # A resample can be degenerate (e.g. every drawn posting shares one label), which makes
    # Spearman undefined. Those draws are dropped below; scipy's warning about them is the
    # expected path here, not a problem worth printing once per resample.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConstantInputWarning)
        for _ in range(resamples):
            picked = rng.integers(0, len(blocks), size=len(blocks))
            idx = np.concatenate([blocks[k] for k in picked])
            d = fn(true[idx], a[idx]) - fn(true[idx], b[idx])
            if np.isfinite(d):
                diffs.append(d)

    diffs = np.array(diffs)
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    # Two-sided achieved significance level: how much of the bootstrap distribution sits
    # on the far side of zero from the observed effect.
    p = 2.0 * min(float((diffs <= 0).mean()), float((diffs >= 0).mean()))
    p = min(1.0, p)

    return {
        "metric": metric,
        "a": engine_a,
        "b": engine_b,
        "a_value": round(fn(true, a), 4),
        "b_value": round(fn(true, b), 4),
        "difference": round(observed, 4),
        "ci95": [round(float(lo), 4), round(float(hi), 4)],
        "p_value": round(p, 4),
        "n_effective_resamples": int(len(diffs)),
        "significant": bool(lo > 0 or hi < 0),
    }


def wilson(hits: int, n: int, z: float = 1.96) -> list[float]:
    """Wilson score interval. Unlike the normal approximation it stays inside [0, 1] and
    keeps roughly nominal coverage for proportions near the boundary."""
    if n == 0:
        return [0.0, 0.0]
    phat = hits / n
    denom = 1 + z**2 / n
    centre = (phat + z**2 / (2 * n)) / denom
    half = z * np.sqrt(phat * (1 - phat) / n + z**2 / (4 * n**2)) / denom
    return [round(float(max(0.0, centre - half)), 4), round(float(min(1.0, centre + half)), 4)]


def leave_one_posting_out(pairs) -> dict:
    """Refit Platt with one posting held out, repeatedly, and score only the held-out pairs.

    Uses the raw fine-tuned cosine as input, which is what the shipped calibrator consumes.
    Every calibrated prediction here comes from a calibrator that never saw the posting it
    is scoring, which is the property the reported MAE cannot claim.
    """
    if "finetuned_raw" not in pairs[0]["preds"]:
        return {"skipped": "demo_pairs.json carries no finetuned_raw column"}

    true = np.array([p["true"] for p in pairs])
    raw = np.array([p["preds"]["finetuned_raw"] for p in pairs])

    groups: dict[str, list[int]] = {}
    for i, p in enumerate(pairs):
        groups.setdefault(p["posting"], []).append(i)

    held = np.zeros(len(pairs))
    for idx in groups.values():
        mask = np.ones(len(pairs), dtype=bool)
        mask[idx] = False
        cal = PlattCalibrator().fit(raw[mask], true[mask])
        held[idx] = np.asarray(cal(raw[idx]))

    reported = np.array([p["preds"][PRODUCTION_ENGINE] for p in pairs])
    return {
        "postings_held_out": len(groups),
        "reported_mae": round(mae(true, reported), 4),
        "leave_one_posting_out_mae": round(mae(true, held), 4),
        "difference": round(mae(true, held) - mae(true, reported), 4),
        "spearman_unchanged": round(spearman(true, held), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--resamples", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(RESULTS / "significance.json"))
    args = parser.parse_args()

    if not DEMO_PAIRS.exists():
        sys.exit(f"Missing {DEMO_PAIRS.relative_to(REPO)}. Run Notebooks/06_model_audit.ipynb first.")

    pairs = load_pairs()
    rng = np.random.default_rng(args.seed)
    available = set(pairs[0]["preds"])
    n_postings = len({p["posting"] for p in pairs})

    print(f"{len(pairs)} pairs from {n_postings} postings | engines: {', '.join(sorted(available))}")
    print(f"Paired cluster bootstrap over postings, {args.resamples} resamples, seed {args.seed}\n")

    challengers = [e for e in ("base_mpnet", "claude", "tfidf", "jaccard") if e in available]
    comparisons = []
    for engine in challengers:
        for metric in ("spearman", "mae"):
            if metric == "mae" and engine not in MAE_COMPARABLE:
                continue
            comparisons.append(
                cluster_bootstrap(pairs, PRODUCTION_ENGINE, engine, metric, args.resamples, rng)
            )

    print(f"{'comparison':<40} {'diff':>8} {'95% CI':>20} {'p':>8}")
    print("-" * 80)
    for c in comparisons:
        label = f"{c['metric']}: production vs {c['b']}"
        ci = f"[{c['ci95'][0]:+.3f}, {c['ci95'][1]:+.3f}]"
        flag = "" if c["significant"] else "   (not distinguishable)"
        print(f"{label:<40} {c['difference']:>+8.4f} {ci:>20} {c['p_value']:>8.4f}{flag}")

    prod = json.loads(PRODUCTION.read_text(encoding="utf-8"))
    rank = prod["ranking"]
    hits, groups = int(rank["hits"]), int(rank["groups"])
    exact = binomtest(hits, groups, 0.25, alternative="greater")
    precision = {
        "hits": hits,
        "postings": groups,
        "precision_at_1": round(hits / groups, 4),
        "wilson_ci95": wilson(hits, groups),
        "random_baseline": 0.25,
        "exact_binomial_p_vs_baseline": float(f"{exact.pvalue:.3e}"),
        "note": "One posting, four candidates, does the true best candidate rank first. "
                "Ranking is invariant to monotone calibration, so this measures the model "
                "rather than the calibrator.",
        "_scope": "Spans all 53 external postings (212 pairs), not only the 50 postings in "
                  "the 106-pair final test that the bootstrap comparisons above use. "
                  "Including the calibration half is legitimate here precisely because "
                  "ranking cannot be affected by the calibrator fitted on it, but it is a "
                  "different denominator and is reported separately for that reason.",
    }
    print(f"\nprecision@1: {hits}/{groups} = {precision['precision_at_1']:.4f}  "
          f"Wilson 95% CI {precision['wilson_ci95']}  "
          f"vs 25% baseline p={precision['exact_binomial_p_vs_baseline']:.2e}")

    lopo = leave_one_posting_out(pairs)
    if "skipped" not in lopo:
        print(f"\nleave-one-posting-out calibration: MAE {lopo['leave_one_posting_out_mae']:.4f} "
              f"vs reported {lopo['reported_mae']:.4f} "
              f"({lopo['difference']:+.4f})")

    payload = {
        "_what": "Which differences between scoring engines survive resampling.",
        "_method": (
            "Paired cluster bootstrap. Postings are the resampling unit because the 106 "
            "pairs come from 50 postings and pairs sharing a posting are not independent. "
            "Both engines score the identical resample, so the difference is paired. The "
            "p-value is the two-sided achieved significance level of the bootstrap "
            "distribution of the difference."
        ),
        "n_pairs": len(pairs),
        "n_postings": n_postings,
        "resamples": args.resamples,
        "seed": args.seed,
        "production_engine": PRODUCTION_ENGINE,
        "comparisons": comparisons,
        "precision_at_1": precision,
        "grouped_calibration_check": lopo,
    }
    out = Path(args.out)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nSaved {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
