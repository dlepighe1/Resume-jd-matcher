"""Measure the skill-gap explanation, which nothing in this repository had tested.

The score has been resampled, calibrated, audited for name sensitivity, and compared
against a frontier model. The explanation next to it has had none of that. It ships two
hand-chosen constants, `COVERED_THRESHOLD = 0.50` and `PARTIAL_THRESHOLD = 0.35`, whose
only recorded justification is a comment saying they were picked on the external test
pairs. In a repository whose stated rule is that a difference is not a result until it is
resampled, that is the largest unmeasured surface left, and it is the part a user reads.

WHAT THIS CAN AND CANNOT ANSWER
--------------------------------
It cannot check whether an individual requirement was correctly called covered. That needs
a human to read the requirement and the cited sentence, and no such labels exist here.
Inventing them from the model's own embeddings would grade the model with its own answer
sheet. Collecting them is recorded in the README as the next thing worth paying for.

What it can answer is whether the coverage number carries the signal it implies. If
coverage means anything, a strong pair must cover more of its posting's requirements than a
weak one, and it must do so on postings the model never trained on. That is a real,
falsifiable prediction of the design, and it is testable with labels that already exist.

Three questions, in the order they change what ships:

1. IS COVERAGE INFORMATIVE? Spearman between coverage and the match label on the untouched
   final-test half, with the same paired cluster bootstrap over postings used everywhere
   else. A coverage number uncorrelated with fit is a decoration.

2. DOES IT SEPARATE THE PAIRS A USER CARES ABOUT? Strong and good matches against weak and
   hard negatives, as a rank statistic. Hard negatives are the interesting half: they are
   keyword-dense and wrong-role, so a coverage measure that counts surface overlap should
   fail here specifically.

3. ARE THE SHIPPED THRESHOLDS DEFENSIBLE? Swept on the CALIBRATION half and reported on the
   FINAL TEST half, which is the discipline the score calibrator already follows. The
   question is not whether some other pair of constants scores higher on the data used to
   choose them, which is guaranteed. It is whether the shipped pair loses anything that
   survives resampling once the tuned pair is moved to data it did not see.

The split is taken from src/train.py rather than redone, so "final test" here means the
same 106 pairs the score is reported on and the calibrator never saw.

Usage:
    python scripts/eval_explanations.py
    python scripts/eval_explanations.py --model models/mpnet-resume-matcher
    python scripts/eval_explanations.py --resamples 2000
"""

import argparse
import json
import sys
import warnings
from pathlib import Path

# Must run before anything imports huggingface_hub, for the reason service/main.py spells
# out: behind a TLS-inspecting proxy the bundled CA store cannot verify huggingface.co, and
# the resulting failure closes hf_hub's shared client so even the cached fallback dies with
# an unrelated-looking "client has been closed". No-op elsewhere.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import numpy as np
import pandas as pd
from scipy.stats import ConstantInputWarning, spearmanr
from sklearn.model_selection import train_test_split

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from app.explain import COVERED_THRESHOLD, PARTIAL_THRESHOLD, analyze_skill_gap  # noqa: E402
from src.train import SEED  # noqa: E402

EXTERNAL = REPO / "Data" / "external_test_200_pairs.csv"
OUT = REPO / "Results" / "explanation_eval.json"
DEFAULT_MODEL = "dlepighe1/resume-jd-matcher-mpnet"

# Pairs a user would act on, against pairs they should walk away from. Splitting on the
# label rather than on the score keeps this independent of the model being evaluated.
POSITIVE_TYPES = {"strong", "good"}

# Swept on the calibration half only. Bounded below by 0.2 because a threshold under the
# similarity floor between any two English documents would mark everything covered, and
# above by 0.75 because nothing in the external set scores there.
SWEEP = np.round(np.arange(0.20, 0.76, 0.05), 2)


def load_splits() -> tuple[pd.DataFrame, pd.DataFrame]:
    """The identical calibration and final-test halves src/train.py produces.

    Re-deriving the split with the same seed and stratification is what makes "final test"
    mean the same thing here as it does everywhere else in the repository. A fresh split
    would produce numbers that look comparable to the published ones and are not.
    """
    external = pd.read_csv(EXTERNAL)
    cal, test = train_test_split(
        external, test_size=0.5, random_state=SEED, stratify=external["match_type"]
    )
    return cal, test


def requirement_similarities(model, frame: pd.DataFrame) -> list[list[float]]:
    """Per-requirement best-matching-sentence similarity, for every pair.

    Computed once and reused for every threshold in the sweep. Re-encoding per threshold
    would multiply an already slow CPU pass by the size of the grid for no new information:
    thresholds only reinterpret these similarities, they do not change them.

    Runs the shipped `analyze_skill_gap`, not a reimplementation of it, so what is measured
    is what the service returns.
    """
    rows = []
    for n, (_, pair) in enumerate(frame.iterrows(), start=1):
        matches, _ = analyze_skill_gap(model, pair["resume"], pair["jd"])
        rows.append([m.similarity for m in matches])
        if n % 25 == 0:
            print(f"  scored {n}/{len(frame)} pairs", flush=True)
    return rows


def coverage_at(similarities: list[float], covered: float, partial: float) -> float:
    """The shipped coverage formula: covered counts one, partial counts a half.

    Kept in step with app.explain.analyze_skill_gap by the test suite rather than by
    inspection, since a silent divergence here would make every number below describe a
    coverage measure the product does not compute.
    """
    if not similarities:
        return 0.0
    sims = np.asarray(similarities)
    return float((np.sum(sims >= covered) + 0.5 * np.sum(
        (sims >= partial) & (sims < covered))) / len(sims))


def coverage_column(sims: list[list[float]], covered: float, partial: float) -> np.ndarray:
    return np.array([coverage_at(s, covered, partial) for s in sims])


def rank_separation(coverage: np.ndarray, positive: np.ndarray) -> float:
    """Probability that a positive pair covers more than a negative one, ties counted half.

    This is the Mann-Whitney statistic, equivalently the ROC area. 0.5 is a coin flip and
    is the number to beat, not zero.
    """
    pos, neg = coverage[positive], coverage[~positive]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    wins = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    return float(wins / (len(pos) * len(neg)))


def cluster_bootstrap(statistic, postings: np.ndarray, resamples: int, rng) -> dict:
    """Percentile interval, resampling postings rather than pairs.

    Same unit as scripts/significance.py and for the same reason: four candidates drawn
    from one posting are not four independent observations, and a pair-level interval here
    would be too narrow in exactly the way the rest of the study is careful to avoid.
    """
    blocks = [np.flatnonzero(postings == p) for p in np.unique(postings)]
    draws = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConstantInputWarning)
        for _ in range(resamples):
            picked = rng.integers(0, len(blocks), size=len(blocks))
            idx = np.concatenate([blocks[k] for k in picked])
            value = statistic(idx)
            if np.isfinite(value):
                draws.append(value)
    draws = np.array(draws)
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return {"ci95": [round(float(lo), 4), round(float(hi), 4)],
            "n_effective_resamples": int(len(draws))}


def evaluate(sims, frame, covered, partial, resamples, rng) -> dict:
    labels = frame["score"].astype(float).to_numpy()
    postings = frame["jd"].to_numpy()
    positive = frame["match_type"].isin(POSITIVE_TYPES).to_numpy()
    coverage = coverage_column(sims, covered, partial)

    rho = float(spearmanr(labels, coverage)[0])
    auc = rank_separation(coverage, positive)

    rho_ci = cluster_bootstrap(
        lambda idx: float(spearmanr(labels[idx], coverage[idx])[0]), postings, resamples, rng)
    auc_ci = cluster_bootstrap(
        lambda idx: rank_separation(coverage[idx], positive[idx]), postings, resamples, rng)

    by_type = {}
    for match_type in sorted(frame["match_type"].unique()):
        mask = (frame["match_type"] == match_type).to_numpy()
        by_type[match_type] = {"n": int(mask.sum()),
                               "mean_coverage": round(float(coverage[mask].mean()), 4)}

    return {
        "thresholds": {"covered": round(float(covered), 2), "partial": round(float(partial), 2)},
        "n_pairs": len(frame),
        "n_postings": int(len(np.unique(postings))),
        "spearman_coverage_vs_label": round(rho, 4),
        "spearman_ci95": rho_ci["ci95"],
        "auc_positive_vs_negative": round(auc, 4),
        "auc_ci95": auc_ci["ci95"],
        "mean_coverage_by_match_type": by_type,
    }


def sweep_thresholds(sims, frame) -> dict:
    """Pick the thresholds that maximise separation on the calibration half.

    Selection happens here and nowhere else. Reporting the winner on the same half that
    chose it would measure the sweep rather than the thresholds, which is the mistake
    notebook 03 exists in this repository to illustrate.
    """
    positive = frame["match_type"].isin(POSITIVE_TYPES).to_numpy()
    best = None
    for covered in SWEEP:
        for partial in SWEEP:
            if partial >= covered:
                continue
            auc = rank_separation(coverage_column(sims, covered, partial), positive)
            if best is None or auc > best["auc"]:
                best = {"covered": float(covered), "partial": float(partial),
                        "auc": round(float(auc), 4)}
    return best


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        help="local checkpoint directory or a HuggingFace repo id")
    parser.add_argument("--resamples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    if not EXTERNAL.exists():
        sys.exit(f"Missing {EXTERNAL.relative_to(REPO)}")

    from sentence_transformers import SentenceTransformer

    print(f"Loading {args.model} ...")
    model = SentenceTransformer(args.model)

    cal, test = load_splits()
    print(f"Calibration half: {len(cal)} pairs | final test: {len(test)} pairs")

    print("Encoding the calibration half (threshold selection):")
    cal_sims = requirement_similarities(model, cal)
    print("Encoding the final-test half (reporting):")
    test_sims = requirement_similarities(model, test)

    tuned = sweep_thresholds(cal_sims, cal)
    print(f"\nBest thresholds on the calibration half: covered {tuned['covered']}, "
          f"partial {tuned['partial']} (AUC {tuned['auc']} there)")

    rng = np.random.default_rng(args.seed)
    shipped_result = evaluate(test_sims, test, COVERED_THRESHOLD, PARTIAL_THRESHOLD,
                              args.resamples, rng)
    tuned_result = evaluate(test_sims, test, tuned["covered"], tuned["partial"],
                            args.resamples, rng)

    # Paired: both threshold pairs are applied to the identical resample, so the difference
    # is not contaminated by which postings happened to be drawn.
    labels = test["score"].astype(float).to_numpy()
    postings = test["jd"].to_numpy()
    shipped_cov = coverage_column(test_sims, COVERED_THRESHOLD, PARTIAL_THRESHOLD)
    tuned_cov = coverage_column(test_sims, tuned["covered"], tuned["partial"])

    positive = test["match_type"].isin(POSITIVE_TYPES).to_numpy()

    def paired_gap(idx):
        return (float(spearmanr(labels[idx], tuned_cov[idx])[0])
                - float(spearmanr(labels[idx], shipped_cov[idx])[0]))

    def paired_auc_gap(idx):
        return (rank_separation(tuned_cov[idx], positive[idx])
                - rank_separation(shipped_cov[idx], positive[idx]))

    everything = np.arange(len(test))
    gap = cluster_bootstrap(paired_gap, postings, args.resamples,
                            np.random.default_rng(args.seed))
    auc_gap = cluster_bootstrap(paired_auc_gap, postings, args.resamples,
                                np.random.default_rng(args.seed))
    observed_gap = paired_gap(everything)
    observed_auc_gap = paired_auc_gap(everything)
    # The sweep maximised AUC, so reporting only Spearman would grade it on a metric it was
    # not optimising. Both are reported and the conclusion requires them to agree.
    tuning_helps = bool(gap["ci95"][0] > 0 and auc_gap["ci95"][0] > 0)

    print(f"\n{'':<28} {'Spearman':>9} {'95% CI':>18} {'AUC':>7} {'95% CI':>18}")
    print("-" * 84)
    for name, r in (("shipped thresholds", shipped_result), ("tuned on calibration", tuned_result)):
        print(f"{name:<28} {r['spearman_coverage_vs_label']:>9.4f} "
              f"[{r['spearman_ci95'][0]:+.3f}, {r['spearman_ci95'][1]:+.3f}]  "
              f"{r['auc_positive_vs_negative']:>7.4f} "
              f"[{r['auc_ci95'][0]:+.3f}, {r['auc_ci95'][1]:+.3f}]")

    print(f"\nRetuning moves final-test Spearman by {observed_gap:+.4f} "
          f"95% CI [{gap['ci95'][0]:+.3f}, {gap['ci95'][1]:+.3f}] and AUC by "
          f"{observed_auc_gap:+.4f} 95% CI [{auc_gap['ci95'][0]:+.3f}, {auc_gap['ci95'][1]:+.3f}]")
    print("Tuned thresholds beat the shipped ones on both metrics; app/explain.py "
          "should be updated." if tuning_helps else
          "The shipped thresholds are not separable from tuned ones on both metrics.")

    payload = {
        "_what": "Does the skill-gap coverage number carry the signal it implies, and are "
                 "the thresholds that produce it defensible.",
        "_scope_limit": (
            "This does NOT validate individual requirement judgements. Whether a specific "
            "requirement was correctly called covered, and whether the sentence cited as "
            "evidence supports it, needs human labels that do not exist in this repository. "
            "Every number here is about the aggregate coverage measure only."
        ),
        "_method": (
            "Thresholds selected on the 106-pair calibration half, reported on the "
            "untouched 106-pair final test, the same discipline the score calibrator "
            "follows. Intervals come from a cluster bootstrap over postings, the resampling "
            "unit used throughout this repository."
        ),
        "model": args.model,
        "resamples": args.resamples,
        "seed": args.seed,
        "shipped_thresholds": shipped_result,
        "tuned_thresholds": tuned_result,
        "threshold_selection": {
            "swept_on": "calibration half",
            "grid": [float(v) for v in SWEEP],
            "best": tuned,
        },
        "retuning_gain_on_final_test": {
            "spearman_difference": round(observed_gap, 4),
            "spearman_ci95": gap["ci95"],
            "auc_difference": round(observed_auc_gap, 4),
            "auc_ci95": auc_gap["ci95"],
            "significant": tuning_helps,
            "_reading": (
                "Positive means tuned thresholds rank better than the shipped ones on data "
                "neither of them was chosen on. Both metrics must clear zero, because the "
                "sweep optimised AUC and grading it only on Spearman would be generous. An "
                "interval straddling zero means the hand-picked constants cost nothing "
                "measurable and can stay."
            ),
        },
    }
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nSaved {Path(args.out).relative_to(REPO)}")


if __name__ == "__main__":
    main()
