"""Decide which differences between scoring engines are real.

The study reports point estimates like "0.8163 for the fine-tuned model, 0.7117 for
Claude". On 106 pairs that gap may or may not survive resampling, and a portfolio claim
that it does needs a test rather than a comparison of two decimals.

Five things happen here.

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

4. MULTIPLICITY. Six engine comparisons and ten ablation comparisons are sixteen chances to
   clear 0.05, and reporting each at its raw p-value runs a family-wise error rate well
   above the number printed next to it. Every comparison therefore carries a
   Holm-Bonferroni adjusted p-value beside its raw one. Families are separated first: the
   pre-registered hypotheses, the exploratory comparisons that accompanied them, and the
   rows that are algebraic restatements of another row rather than independent tests.

5. EQUIVALENCE AND POWER. Several conclusions here rest on a difference NOT being found,
   and "we did not detect a difference" is not the claim "there is none". Each comparison
   gets a two-one-sided-tests verdict against a margin equal to what re-running the
   identical recipe already costs, plus the smallest effect it could have detected and the
   number of postings that would settle it. On 50 postings this turns several of the
   study's tidier conclusions into honest open questions, which is the point.

A second mode, --ablation, applies the same paired cluster bootstrap to the loss-ablation
arms from Notebooks/07 instead of to the scoring engines. It lives here rather than in the
notebook so this project has exactly one implementation of the bootstrap.

Usage:
    python scripts/significance.py
    python scripts/significance.py --resamples 20000
    python scripts/significance.py --ablation
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
ABLATION = RESULTS / "loss_ablation.json"

PRODUCTION_ENGINE = "finetuned_calibrated"

# The arm notebook 05 ships. Every ablation comparison is stated against it, so a result
# reads as "dropping the second loss term costs X" rather than as an unanchored table.
ABLATION_REFERENCE = "combined_platt"

# The hypothesis notebook 07 registered before any run existed: after Platt calibration,
# CoSENT alone is indistinguishable from the combined loss, on both reported metrics.
# Everything else the ablation computed (the CosineSimilarity arm, the seed ensembles) was
# worth reporting but was not the question, and is corrected as a secondary family.
ABLATION_PRIMARY = {("cosent_platt", "spearman"), ("cosent_platt", "mae")}

# The engine comparisons all answer questions docs/RESEARCH_SPEC.md registered as the point
# of the study: does a purpose-built model beat a frontier language model, and is any of it
# better than counting words. None of them is an afterthought, so they form one primary
# family rather than a headline plus a tail of extras.
ENGINE_PRIMARY = {(engine, metric)
                  for engine in ("base_mpnet", "claude", "tfidf", "jaccard")
                  for metric in ("spearman", "mae")}

# MAE compares a prediction against a 0-1 label. TF-IDF and Jaccard produce a similarity
# that was never meant to estimate that label, so their MAE measures the scale mismatch
# rather than the method. Rank quality is the only comparable axis for them.
MAE_COMPARABLE = {"finetuned_calibrated", "finetuned_raw", "base_mpnet", "claude"}

# Two-sided 5% and 80% power. Used only for the minimum detectable effect, which is a
# normal-approximation summary of the bootstrap spread rather than an exact power curve.
Z_ALPHA = 1.959964
Z_POWER = 0.841621

MULTIPLICITY_NOTE = (
    "Every comparison in this file belongs to one family reported together, so each carries "
    "a Holm-Bonferroni adjusted p-value beside its raw one. `significant_holm` requires both "
    "the adjusted p-value below 0.05 and a 95% interval excluding zero. The raw p-value is "
    "kept so the cost of the correction is visible rather than absorbed."
)

EQUIVALENCE_NOTE = (
    "`significant: false` means a difference was not detected, which is not the same claim "
    "as no difference. Each comparison therefore also carries a two-one-sided-tests result: "
    "equivalent when the 90% interval lies entirely inside the margin. The margin is this "
    "project's measured reproducibility spread, not a round number (see equivalence_margins)."
    " `min_detectable_effect_80pct_power` says what the comparison could have found, so an "
    "inconclusive verdict can be read as a limit on the design rather than a result."
)


def holm_bonferroni(p_values: list[float]) -> list[float]:
    """Holm step-down adjusted p-values, in the input order.

    Eleven bootstrap comparisons are eleven chances to clear 0.05, and a study that
    reports each one at its raw p-value is quietly running a family-wise error rate far
    above the number it prints. Holm is used rather than plain Bonferroni because it is
    uniformly more powerful and makes no independence assumption, which matters here since
    the comparisons share the production engine and the same 106 pairs.

    Adjusted values are forced non-decreasing along the sorted order, which is what makes
    the step-down procedure coherent: a comparison can never be adjusted to less than one
    that was more extreme than it.
    """
    n = len(p_values)
    if n == 0:
        return []
    order = sorted(range(n), key=lambda i: p_values[i])
    adjusted = [0.0] * n
    running = 0.0
    for rank, idx in enumerate(order):
        running = max(running, (n - rank) * p_values[idx])
        adjusted[idx] = min(1.0, running)
    return adjusted


def reproducibility_margins() -> dict:
    """Equivalence margins, derived from artifacts rather than typed.

    The margin is the question "how small is too small to matter?", and answering it with a
    round number chosen by taste would make every equivalence claim below arbitrary. This
    project can do better, because it accidentally measured its own noise floor: notebook
    07's `combined` arm re-runs notebook 05's exact recipe, so the gap between those two
    published aggregates is what re-running an unchanged design costs. A difference smaller
    than that cannot be acted on, since the next run of either arm would erase it.

    Reading the two artifacts keeps the margin honest across re-runs. A margin typed as a
    literal would keep asserting a noise floor the project had stopped measuring, which is
    the exact failure mode tests/test_results_consistency.py exists to prevent.

    Caveat, stated because it qualifies every equivalence verdict that uses it: the
    `combined` arm is also one side of the ablation comparisons, so the margin is not drawn
    from data fully independent of them. It is a reproducibility estimate, not a
    pre-registered clinical threshold.
    """
    if not (PRODUCTION.exists() and ABLATION.exists()):
        return {}
    try:
        prod = json.loads(PRODUCTION.read_text(encoding="utf-8"))["aggregate"]["platt"]
        arm = json.loads(ABLATION.read_text(encoding="utf-8"))["aggregate"]["combined"]["platt"]
    except KeyError:
        # An export without the multi-seed aggregates cannot measure a noise floor. Return
        # no margin rather than a fabricated one: every equivalence verdict downstream then
        # reports itself as untested, which is the honest outcome.
        return {}
    return {
        "spearman": round(abs(arm["spearman_mean"] - prod["spearman_mean"]), 4),
        "mae": round(abs(arm["mae_mean"] - prod["mae_mean"]), 4),
        "_derivation": (
            "|notebook 07 `combined` arm - notebook 05 published run| on the 3-seed "
            "aggregate, Platt. Both are the identical recipe, so this is the spread of "
            "re-running an unchanged design rather than a difference between designs."
        ),
    }


def postings_needed(comparison: dict, margin: float, n_postings: int) -> int | None:
    """How many postings this comparison would need to resolve at the margin.

    An inconclusive result is only useful if it says what would have settled it. The
    bootstrap standard error scales as 1/sqrt(number of clusters), so the sample size at
    which the minimum detectable effect shrinks to the margin scales as the square of the
    ratio between them. Rounded up, and returned as postings because postings, not pairs,
    are the unit that carries independent information here.

    Approximate by construction: it assumes the effect size and the between-posting
    variance hold as the sample grows, which is the standard assumption of any power
    calculation and is worth exactly as much here as it is anywhere else.
    """
    mde = comparison["min_detectable_effect_80pct_power"]
    if not margin or mde <= margin:
        return None
    return int(np.ceil(n_postings * (mde / margin) ** 2))


def equivalence(comparison: dict, margin: float | None) -> dict:
    """Two one-sided tests, run as a 90% interval against a margin.

    Failing to reject "there is a difference" is not evidence that there is none, and this
    study leans on two null results: the calibrators are called a tie, and half the loss
    function is called droppable. Both deserve a test that can actually support them.

    TOST at the 5% level is exactly the 90% interval falling inside the margin, so the
    bootstrap's 5th and 95th percentiles are all that is needed.
    """
    if margin is None:
        return {"tested": False, "reason": "no reproducibility margin available"}
    lo, hi = comparison["ci90"]
    return {
        "tested": True,
        "margin": round(float(margin), 4),
        "equivalent": bool(-margin < lo and hi < margin),
    }


def verdict_for(comparison: dict) -> str:
    """Combine the difference test and the equivalence test into one of three answers.

    Reporting only the difference test collapses "we showed these are the same" and "we
    could not tell" into the same phrase, and those are the two most confusable statements
    in a small-sample study. Read against the Holm-adjusted p-value, since that is the one
    that accounts for how many comparisons were run.
    """
    different = comparison["significant_holm"]
    equal = comparison["equivalence"].get("equivalent", False)
    if different and equal:
        return "different but smaller than the reproducibility margin"
    if different:
        return "different"
    if equal:
        return "equivalent"
    return "inconclusive"


def classify_families(comparisons: list[dict], primary: set[tuple[str, str]]) -> None:
    """Sort comparisons into primary, secondary, and redundant, before any correction.

    Getting this wrong in either direction is a real error, so the rule is stated rather
    than chosen. Correcting over too few tests understates the family-wise error rate.
    Correcting over too many buries a genuine effect under comparisons that were never
    hypotheses, which is how a correction becomes its own kind of bad statistics.

    REDUNDANT. Spearman depends only on ranks, and Platt scaling is a strictly increasing
    sigmoid, so an arm's raw and calibrated Spearman are the same number by construction,
    not by measurement. Counting both as separate tests would penalise every real
    comparison for an algebraic identity. The reference arm compared against itself is
    excluded for the same reason: its difference is exactly zero and nothing was tested.
    These stay in the output, because deleting them would hide the reason the family is
    the size it is, but they take no share of the correction.

    PRIMARY. The hypotheses the study registered before running. Conventionally these are
    not discounted for the exploratory comparisons that accompany them.

    SECONDARY. Everything else that was computed and is worth reporting. Corrected within
    its own family and labelled, so a reader can see which conclusions are confirmatory
    and which are the study noticing something afterwards.

    Note the rule is purely structural: it is applied to the identity of the comparison,
    never to its p-value. A family drawn after seeing which tests cleared 0.05 would be
    the multiplicity problem wearing a correction as a disguise.
    """
    calibrated_spearman = {c["b"].rsplit("_", 1)[0] for c in comparisons
                           if c["metric"] == "spearman" and c["b"].endswith("_platt")}
    reference_arm = comparisons[0]["a"].rsplit("_", 1)[0] if comparisons else None

    for c in comparisons:
        arm, _, calibration = c["b"].rpartition("_")
        redundant = c["metric"] == "spearman" and (
            (arm == reference_arm and calibration in {"raw", "platt"})
            or (calibration == "raw" and arm in calibrated_spearman)
        )
        if redundant:
            c["family"] = "redundant"
        elif (c["b"], c["metric"]) in primary:
            c["family"] = "primary"
        else:
            c["family"] = "secondary"


def annotate_family(comparisons: list[dict], margins: dict, n_postings: int,
                    primary: set[tuple[str, str]] | None = None) -> list[dict]:
    """Apply the multiplicity correction and equivalence test to one run's comparisons.

    Holm runs separately within the primary and secondary families, since a step-down
    procedure is only coherent inside the set of hypotheses it is protecting.
    """
    classify_families(comparisons, primary or set())

    for group in ("primary", "secondary"):
        members = [c for c in comparisons if c["family"] == group]
        for c, p_adj in zip(members, holm_bonferroni([m["p_value"] for m in members]), strict=False):
            c["p_value_holm"] = round(float(p_adj), 4)
            c["significant_holm"] = bool(p_adj < 0.05 and c["significant"])

    for c in comparisons:
        if c["family"] == "redundant":
            # Algebraically determined by another row, so it gets no adjusted p-value and
            # no verdict of its own. Reporting one would imply an independent test.
            c["p_value_holm"] = None
            c["significant_holm"] = False
            c["equivalence"] = {"tested": False, "reason": "algebraically redundant"}
            c["verdict"] = "redundant with the calibrated comparison of the same arm"
            continue
        margin = margins.get(c["metric"])
        c["equivalence"] = equivalence(c, margin)
        c["verdict"] = verdict_for(c)
        if c["verdict"] == "inconclusive" and margin:
            c["postings_to_resolve_at_margin"] = postings_needed(c, margin, n_postings)

    return comparisons


def print_comparisons(comparisons: list[dict], label_of) -> None:
    """One row per comparison, carrying the adjusted p-value and the three-way verdict.

    The raw p-value is printed too. Hiding it would make the correction unauditable, and
    the point of the correction is that a reader can see what it cost.
    """
    header = (f"{'comparison':<46} {'diff':>8} {'95% CI':>18} {'p':>7} {'p_holm':>7}  "
              f"{'family':<10} verdict")
    print(header)
    print("-" * len(header))
    for c in comparisons:
        ci = f"[{c['ci95'][0]:+.3f}, {c['ci95'][1]:+.3f}]"
        holm = "     -" if c["p_value_holm"] is None else f"{c['p_value_holm']:>7.4f}"
        print(f"{label_of(c):<46} {c['difference']:>+8.4f} {ci:>18} "
              f"{c['p_value']:>7.4f} {holm}  {c['family']:<10} {c['verdict']}")

    inconclusive = [c for c in comparisons if c["verdict"] == "inconclusive"]
    if inconclusive:
        print(f"\n{len(inconclusive)} comparison(s) inconclusive: neither separable nor shown "
              f"equivalent. What each would need to settle:")
        print(f"  {'':<44} {'MDE@80%':>9} {'postings needed':>16}")
        for c in inconclusive:
            needed = c.get("postings_to_resolve_at_margin")
            print(f"  {label_of(c):<44} {c['min_detectable_effect_80pct_power']:>9.4f} "
                  f"{(str(needed) if needed else '-'):>16}")


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
    # The 90% interval is not a second opinion on the 95% one. TOST at the 5% level is
    # exactly "the 90% interval lies inside the margin", so equivalence needs this and
    # cannot be read off the interval above.
    lo90, hi90 = np.percentile(diffs, [5, 95])
    # Two-sided achieved significance level: how much of the bootstrap distribution sits
    # on the far side of zero from the observed effect.
    p = 2.0 * min(float((diffs <= 0).mean()), float((diffs >= 0).mean()))
    p = min(1.0, p)

    # What this comparison could have detected, as opposed to what it did. On 50 postings
    # most of these are large, and saying so is the difference between "no effect" and
    # "no effect this design could see". Normal approximation to the bootstrap spread.
    se = float(np.std(diffs, ddof=1)) if len(diffs) > 1 else 0.0

    return {
        "metric": metric,
        "a": engine_a,
        "b": engine_b,
        "a_value": round(fn(true, a), 4),
        "b_value": round(fn(true, b), 4),
        "difference": round(observed, 4),
        "ci95": [round(float(lo), 4), round(float(hi), 4)],
        "ci90": [round(float(lo90), 4), round(float(hi90), 4)],
        "p_value": round(p, 4),
        "bootstrap_se": round(se, 4),
        "min_detectable_effect_80pct_power": round((Z_ALPHA + Z_POWER) * se, 4),
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


def load_ablation_pairs() -> tuple[list[dict], list[str]]:
    """The 106 final-test pairs as scored by every arm of the loss ablation."""
    data = json.loads(ABLATION.read_text(encoding="utf-8"))
    pairs = [{
        "id": p["id"],
        "true": float(p["true"]),
        "posting": p["jd"],
        "match_type": p["match_type"],
        "preds": {k: float(v) for k, v in p["preds"].items()},
    } for p in data["pairs"]]

    # Guard the same way the demo pipeline does. The ablation is only interpretable against
    # notebook 05 if it ran on notebook 05's split.
    if DEMO_PAIRS.exists():
        shipped = {p["id"] for p in json.loads(DEMO_PAIRS.read_text(encoding="utf-8"))["pairs"]}
        got = {p["id"] for p in pairs}
        if shipped != got:
            raise SystemExit(
                f"Ablation ran on a different test split: {len(got - shipped)} pairs are not "
                f"in Results/demo_pairs.json. The comparison would not be paired."
            )
    return pairs, list(data["arms"])


def run_ablation(resamples: int, seed: int, out_path: Path) -> None:
    if not ABLATION.exists():
        sys.exit(f"Missing {ABLATION.relative_to(REPO)}. Run Notebooks/07_loss_ablation.ipynb "
                 f"and copy its loss_ablation.json into Results/.")

    pairs, arms = load_ablation_pairs()
    rng = np.random.default_rng(seed)
    available = set(pairs[0]["preds"])
    n_postings = len({p["posting"] for p in pairs})

    if ABLATION_REFERENCE not in available:
        sys.exit(f"{ABLATION_REFERENCE} missing from the ablation export; found {sorted(available)}")

    print(f"{len(pairs)} pairs from {n_postings} postings | arms: {', '.join(arms)}")
    print(f"Reference arm: {ABLATION_REFERENCE}")
    print(f"Paired cluster bootstrap over postings, {resamples} resamples, seed {seed}\n")

    challengers = [e for e in sorted(available) if e != ABLATION_REFERENCE]
    comparisons = []
    for engine in challengers:
        for metric in ("spearman", "mae"):
            # Raw cosine is not an estimate of the label, so its MAE measures the missing
            # calibrator rather than the loss. Only calibrated arms get an MAE comparison.
            if metric == "mae" and not (engine.endswith("_platt")
                                        and ABLATION_REFERENCE.endswith("_platt")):
                continue
            comparisons.append(
                cluster_bootstrap(pairs, ABLATION_REFERENCE, engine, metric, resamples, rng))

    margins = reproducibility_margins()
    annotate_family(comparisons, margins, n_postings, primary=ABLATION_PRIMARY)
    print_comparisons(comparisons, lambda c: f"{c['metric']}: {ABLATION_REFERENCE} vs {c['b']}")

    # H1 is a null hypothesis of no difference, so "we failed to reject it" is the weakest
    # possible support. The verdict therefore reports whether the equivalence test cleared
    # it, and says so explicitly when it did not, rather than letting a non-significant
    # p-value stand in for a demonstrated tie.
    h1_arms = [c for c in comparisons if c["b"] == "cosent_platt"]
    verdict = None
    if h1_arms:
        separable = [c for c in h1_arms if c["significant_holm"]]
        equivalent = [c for c in h1_arms if c["equivalence"].get("equivalent")]
        if separable:
            metrics_ = ", ".join(sorted(c["metric"] for c in separable))
            verdict = (f"H1 REJECTED: the combined loss and CoSENT alone are separable on "
                       f"{metrics_}.")
        elif len(equivalent) == len(h1_arms):
            verdict = ("H1 SUPPORTED, by equivalence: on every metric the difference "
                       "between CoSENT alone and the combined loss falls inside the margin "
                       "that re-running the identical recipe already costs, so the "
                       "CosineSimilarity term can be dropped.")
        else:
            undecided = ", ".join(sorted(c["metric"] for c in h1_arms
                                         if not c["equivalence"].get("equivalent")))
            verdict = ("H1 SUPPORTED WEAKLY: CoSENT alone is not separable from the "
                       f"combined loss, but equivalence is not established on {undecided}, "
                       "so this is a failure to detect a difference rather than a "
                       "demonstrated tie.")
        print(f"\n{verdict}")

    payload = {
        "_what": "Does the combined loss beat its components, tested rather than asserted.",
        "_method": (
            "Paired cluster bootstrap over postings, the same implementation used for the "
            "engine comparisons in significance.json. Every arm scored the identical 106 "
            "pairs, and gradient-step count was matched across arms by giving each arm two "
            "training objectives, so the only difference is which loss is applied."
        ),
        "_preregistered_hypothesis": (
            "H1: after Platt calibration, CoSENT alone is indistinguishable from the combined "
            "loss, because calibration already recovers the magnitude information the "
            "CosineSimilarity term supplies. Registered in Notebooks/07 before the runs."
        ),
        "_multiplicity": MULTIPLICITY_NOTE,
        "_equivalence": EQUIVALENCE_NOTE,
        "reference_arm": ABLATION_REFERENCE,
        "n_pairs": len(pairs),
        "n_postings": n_postings,
        "resamples": resamples,
        "seed": seed,
        "equivalence_margins": margins,
        "comparisons": comparisons,
        "h1_verdict": verdict,
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nSaved {out_path.relative_to(REPO)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--resamples", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(RESULTS / "significance.json"))
    parser.add_argument("--ablation", action="store_true",
                        help="compare the loss-ablation arms instead of the scoring engines")
    args = parser.parse_args()

    if args.ablation:
        out = Path(args.out)
        if out == RESULTS / "significance.json":
            out = RESULTS / "loss_ablation_significance.json"
        run_ablation(args.resamples, args.seed, out)
        return

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

    margins = reproducibility_margins()
    annotate_family(comparisons, margins, n_postings, primary=ENGINE_PRIMARY)
    print_comparisons(comparisons, lambda c: f"{c['metric']}: production vs {c['b']}")

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
        "_multiplicity": MULTIPLICITY_NOTE,
        "_equivalence": EQUIVALENCE_NOTE,
        "n_pairs": len(pairs),
        "n_postings": n_postings,
        "resamples": args.resamples,
        "seed": args.seed,
        "production_engine": PRODUCTION_ENGINE,
        "equivalence_margins": margins,
        "comparisons": comparisons,
        "precision_at_1": precision,
        "grouped_calibration_check": lopo,
    }
    out = Path(args.out)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nSaved {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
