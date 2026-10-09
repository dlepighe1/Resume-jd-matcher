"""Ask whether the synthetic resumes leak their job description.

The risk this exists to measure. The job postings are real, but the resumes were written
against them. If the generator paraphrased a posting to produce its "strong match" resume,
then part of what the model learned is that a good pair shares phrasing, not that a good pair
shares skills. External validation cannot detect this: the training half and the external
half were produced the same way, so both carry the artifact and the transfer looks clean.

That would not invalidate the study, but it would cap every number in it, and
`docs/DATA_CARD.md` currently documents provenance, splits and rubric limits without
addressing it.

Nothing here needs the model or the network. It reads the CSVs and the per-pair predictions
that Notebooks/06 already exported.

THREE TESTS
-----------
1. LONG SHARED N-GRAMS. Genuine skill overlap produces short shared phrases: a resume and a
   posting both say "Python and SQL". Paraphrase copying produces long shared spans: both say
   "designing and analyzing A/B tests at scale". So the signature is not how much overlap
   exists but how LONG the overlapping spans are, and whether strong pairs specifically show
   more of it than a matched control.

   The control is each resume scored against a different posting from the same industry. That
   holds domain vocabulary roughly constant, so what is left at n = 6 and n = 8 is either
   copying or coincidence.

2. POSTING-UNIQUE RARE TERMS. Terms appearing in exactly one posting across the whole corpus
   are that posting's fingerprint: a niche tool, an internal product name, an unusual phrasing.
   A real resume has no reason to contain one. Counting how often a resume carries its own
   posting's unique terms is the most direct copying test available.

3. SIGNAL BEYOND OVERLAP. If the model is largely reading lexical overlap, then removing
   overlap should remove its correlation with the label. This residualises both on overlap
   rank and re-correlates. The audit already reports TF-IDF at 0.5656 against the model's
   0.8163, which suggests headroom; this measures it directly rather than by comparison.

Usage:
    python scripts/audit_generation_artifacts.py
    python scripts/audit_generation_artifacts.py --resamples 5000
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

RESULTS = REPO / "Results"
DEMO_PAIRS = RESULTS / "demo_pairs.json"
TRAINING = REPO / "Data" / "resume_jd_training_800.csv"
EXTERNAL = REPO / "Data" / "external_test_200_pairs.csv"
OUT = RESULTS / "generation_artifacts.json"

# Short n captures shared skill vocabulary, which is the signal the model is supposed to use.
# Long n captures shared phrasing, which is the artifact. Both are reported so the contrast
# is visible rather than asserted.
NGRAM_SIZES = (2, 4, 6, 8)

# The band where a shared span stops being a skill name and starts being a sentence.
ARTIFACT_N = 6

POSITIVE_TYPES = {"strong", "good"}

TOKEN = re.compile(r"[a-z0-9+#.]+")


def display_path(path: Path) -> str:
    """Repo-relative when it can be, absolute otherwise.

    `Path.relative_to` raises rather than falling back, so an --out pointing anywhere outside
    the repository crashed the run after the results had already been written. Losing a
    completed benchmark to a print statement is a silly way to lose one.
    """
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def tokenize(text: str) -> list[str]:
    """Lowercased alphanumeric tokens, keeping the characters that carry meaning in skill
    names. Dropping them would merge `c++` into `c` and `.net` into `net`."""
    return TOKEN.findall(str(text).lower())


def ngrams(tokens: list[str], n: int) -> set[tuple]:
    if len(tokens) < n:
        return set()
    return {tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)}


def overlap_rate(resume_tokens: list[str], jd_tokens: list[str], n: int) -> float:
    """Share of the resume's n-grams that also appear in the posting.

    Normalised by the resume rather than by the posting, because postings vary in length by
    an order of magnitude and an unnormalised count would mostly measure that.
    """
    resume_grams = ngrams(resume_tokens, n)
    if not resume_grams:
        return 0.0
    return len(resume_grams & ngrams(jd_tokens, n)) / len(resume_grams)


def build_controls(frame: pd.DataFrame, rng) -> list[int]:
    """For each row, the index of a different posting from the same industry.

    Same industry matters. Comparing a DevOps resume against a nursing posting would show
    near-zero overlap and make any own-posting overlap look damning, when most of it is just
    domain vocabulary. Falls back to any different posting when an industry has only one.
    """
    controls = []
    for i, row in enumerate(frame.itertuples()):
        same_industry = frame.index[(frame["industry"] == row.industry)
                                    & (frame["jd"] != row.jd)].tolist()
        pool = same_industry or frame.index[frame["jd"] != row.jd].tolist()
        controls.append(int(rng.choice(pool)) if pool else i)
    return controls


def unique_terms_by_posting(frame: pd.DataFrame) -> dict[str, set[str]]:
    """Terms that appear in exactly one posting in the corpus, grouped by that posting.

    Computed over every posting available, training and external together, so "unique" means
    unique in the corpus rather than unique in a split.
    """
    postings = frame.drop_duplicates(subset="jd")["jd"].tolist()
    tokenized = [set(tokenize(p)) for p in postings]

    counts: Counter = Counter()
    for terms in tokenized:
        counts.update(terms)

    return {posting: {t for t in terms if counts[t] == 1}
            for posting, terms in zip(postings, tokenized, strict=True)}


def cluster_bootstrap_mean(values: np.ndarray, postings: np.ndarray, resamples: int,
                           rng) -> list[float]:
    """Percentile interval for a mean, resampling postings. Same unit as everywhere else."""
    blocks = [np.flatnonzero(postings == p) for p in np.unique(postings)]
    draws = []
    for _ in range(resamples):
        picked = rng.integers(0, len(blocks), size=len(blocks))
        idx = np.concatenate([blocks[k] for k in picked])
        draws.append(float(values[idx].mean()))
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return [round(float(lo), 5), round(float(hi), 5)]


def residualise(x: np.ndarray, control: np.ndarray) -> np.ndarray:
    """Residual of x after a linear fit on control, both already converted to ranks.

    Rank-then-linear is Spearman partial correlation. Doing it on raw values instead would
    assume the label and the overlap rate are linearly related, which they are not.
    """
    design = np.vstack([control, np.ones_like(control)]).T
    coefficients, *_ = np.linalg.lstsq(design, x, rcond=None)
    return x - design @ coefficients


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--resamples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    for path in (TRAINING, EXTERNAL):
        if not path.exists():
            sys.exit(f"Missing {path.relative_to(REPO)}")

    rng = np.random.default_rng(args.seed)

    training = pd.read_csv(TRAINING)
    external = pd.read_csv(EXTERNAL)
    corpus = pd.concat([training, external], ignore_index=True)

    # Every claim below is about the external set, which is what the study reports on. The
    # training set is loaded only so "unique in the corpus" means what it says.
    frame = external.reset_index(drop=True)
    resume_tokens = [tokenize(r) for r in frame["resume"]]
    jd_tokens = [tokenize(j) for j in frame["jd"]]
    controls = build_controls(frame, rng)

    print(f"{len(frame)} external pairs from {frame['jd'].nunique()} postings")
    print(f"Corpus for uniqueness: {corpus['jd'].nunique()} postings\n")

    # ── Test 1. Long shared n-grams, own posting against a same-industry control ──
    by_size = {}
    for n in NGRAM_SIZES:
        own = np.array([overlap_rate(resume_tokens[i], jd_tokens[i], n)
                        for i in range(len(frame))])
        control = np.array([overlap_rate(resume_tokens[i], jd_tokens[controls[i]], n)
                            for i in range(len(frame))])
        excess = own - control

        by_type = {}
        for match_type in sorted(frame["match_type"].unique()):
            mask = (frame["match_type"] == match_type).to_numpy()
            by_type[match_type] = {
                "own": round(float(own[mask].mean()), 5),
                "control": round(float(control[mask].mean()), 5),
                "excess": round(float(excess[mask].mean()), 5),
            }

        positive = frame["match_type"].isin(POSITIVE_TYPES).to_numpy()
        gap = float(excess[positive].mean() - excess[~positive].mean())
        by_size[n] = {
            "mean_own": round(float(own.mean()), 5),
            "mean_control": round(float(control.mean()), 5),
            "mean_excess": round(float(excess.mean()), 5),
            "excess_ci95": cluster_bootstrap_mean(excess, frame["jd"].to_numpy(),
                                                  args.resamples, rng),
            "positive_minus_negative_excess": round(gap, 5),
            "by_match_type": by_type,
        }

    print(f"{'n':>3} {'own':>9} {'control':>9} {'excess':>9} {'excess 95% CI':>22}  "
          f"{'strong+good minus weak':>24}")
    print("-" * 82)
    for n, row in by_size.items():
        ci = f"[{row['excess_ci95'][0]:+.4f}, {row['excess_ci95'][1]:+.4f}]"
        print(f"{n:>3} {row['mean_own']:>9.4f} {row['mean_control']:>9.4f} "
              f"{row['mean_excess']:>9.4f} {ci:>22}  "
              f"{row['positive_minus_negative_excess']:>+24.4f}")

    # ── Test 2. Posting-unique rare terms appearing in the paired resume ──
    unique_terms = unique_terms_by_posting(corpus)
    leaked = np.array([
        len(unique_terms.get(frame["jd"].iloc[i], set()) & set(resume_tokens[i]))
        for i in range(len(frame))
    ], dtype=float)

    leak_by_type = {}
    for match_type in sorted(frame["match_type"].unique()):
        mask = (frame["match_type"] == match_type).to_numpy()
        leak_by_type[match_type] = {
            "mean_unique_terms_leaked": round(float(leaked[mask].mean()), 4),
            "pairs_with_any_leak": int((leaked[mask] > 0).sum()),
            "n": int(mask.sum()),
        }

    print(f"\nPosting-unique terms appearing in the paired resume "
          f"({int((leaked > 0).sum())} of {len(frame)} pairs carry at least one):")
    for match_type, row in leak_by_type.items():
        print(f"  {match_type:<14} mean {row['mean_unique_terms_leaked']:>6.3f}   "
              f"{row['pairs_with_any_leak']:>3}/{row['n']} pairs")

    # ── Test 3. Does the model's ranking survive controlling for overlap? ──
    beyond_overlap = {"skipped": "demo_pairs.json not present"}
    if DEMO_PAIRS.exists():
        demo = json.loads(DEMO_PAIRS.read_text(encoding="utf-8"))["pairs"]
        rows = []
        for pair in demo:
            r, j = tokenize(pair["resume"]), tokenize(pair["jd"])
            rows.append({
                "true": float(pair["true"]),
                "pred": float(pair["preds"]["finetuned_calibrated"]),
                "overlap": overlap_rate(r, j, ARTIFACT_N),
                "overlap_short": overlap_rate(r, j, 2),
            })
        table = pd.DataFrame(rows)

        def rank(column):
            return pd.Series(table[column]).rank().to_numpy()

        raw = float(spearmanr(table["true"], table["pred"])[0])
        beyond_overlap = {
            "spearman_uncontrolled": round(raw, 4),
            "overlap_alone_vs_label": round(
                float(spearmanr(table["true"], table["overlap_short"])[0]), 4),
        }
        for label, control_column in (("long_ngrams", "overlap"),
                                      ("short_ngrams", "overlap_short")):
            partial = float(np.corrcoef(
                residualise(rank("true"), rank(control_column)),
                residualise(rank("pred"), rank(control_column)),
            )[0, 1])
            beyond_overlap[f"partial_spearman_controlling_{label}"] = round(partial, 4)

        print(f"\nModel against the label, uncontrolled:            {raw:.4f}")
        print(f"  controlling for {ARTIFACT_N}-gram overlap:                "
              f"{beyond_overlap['partial_spearman_controlling_long_ngrams']:.4f}")
        print(f"  controlling for 2-gram overlap:                 "
              f"{beyond_overlap['partial_spearman_controlling_short_ngrams']:.4f}")
        print(f"  lexical overlap alone against the label:        "
              f"{beyond_overlap['overlap_alone_vs_label']:.4f}")

    artifact_excess = by_size[ARTIFACT_N]["excess_ci95"]
    detected = bool(artifact_excess[0] > 0)
    verdict = (
        f"Long-span copying DETECTED: at n={ARTIFACT_N}, resumes share more with their own "
        f"posting than with a same-industry control, 95% CI {artifact_excess}. Every number "
        f"in this repository is capped by it and the data card must say so."
        if detected else
        f"No long-span copying detected: at n={ARTIFACT_N} the excess over a same-industry "
        f"control has a 95% interval of {artifact_excess}, which includes zero. The resumes "
        f"do not appear to be paraphrases of their postings."
    )
    print(f"\n{verdict}")

    payload = {
        "_what": "Whether the synthetic resumes leak the phrasing of the postings they were "
                 "written against, which would inflate every result in this repository.",
        "_method": (
            "Own-posting n-gram overlap against a same-industry control posting, so domain "
            "vocabulary is held roughly constant and what remains at long n is copying. "
            "Plus posting-unique term leakage, and a rank partial correlation asking whether "
            "the model's agreement with the label survives removing lexical overlap. "
            "Intervals from a cluster bootstrap over postings."
        ),
        "_scope": "Measured on the 212-pair external set, which is what the study reports on. "
                  "Term uniqueness is computed over training and external postings together.",
        "_limitation": (
            "This compares synthetic pairs against synthetic pairs. It can detect that a "
            "resume was paraphrased from its own posting, and it cannot detect that synthetic "
            "resumes as a class are cleaner, more keyword-dense, or more uniformly structured "
            "than real ones. That needs real resumes, which is Tier 2 of "
            "docs/VALIDATION_ROADMAP.md."
        ),
        "n_pairs": int(len(frame)),
        "n_postings": int(frame["jd"].nunique()),
        "corpus_postings": int(corpus["jd"].nunique()),
        "resamples": args.resamples,
        "seed": args.seed,
        "ngram_overlap": {str(k): v for k, v in by_size.items()},
        "posting_unique_term_leakage": {
            "pairs_with_any_leak": int((leaked > 0).sum()),
            "by_match_type": leak_by_type,
        },
        "signal_beyond_overlap": beyond_overlap,
        "artifact_detected": detected,
        "verdict": verdict,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nSaved {display_path(Path(args.out))}")


if __name__ == "__main__":
    main()
