"""Intervene on the resume and check the score moves the way the design claims it does.

Every other number in this repository is correlational. The model agrees with a label across
106 pairs, and that agreement is resampled, corrected, and bounded. None of it establishes
that the score responds to requirement coverage, because a model reading something else
entirely could produce the same correlation.

These are interventions. Each takes a real held-out pair, changes exactly one thing, and
checks the score moves in the direction the product's copy already promises. They need no
labels, which is why they are Tier 0 of docs/VALIDATION_ROADMAP.md: nothing here waits on
recruiters.

The four tests, and what a failure would mean:

  DROP_EVIDENCE      Remove the resume sentence that best covers the top requirement.
                     The score must fall. If it does not, the score is not reading coverage.

  KEYWORD_STUFF      Append up to 15 of the posting's distinctive tool names to a WEAK
                     resume as a bare skills line, excluding any the resume already contains.
                     The score must not rise materially. This is the sharpest test in the
                     file, because hard negatives in training were built to be exactly this,
                     and the product warns users against doing it.

                     Terms, not sentences. The first version of this test appended the full
                     requirement text, roughly 200 words against a median resume of 106, and
                     measured what happens when you paste a posting into a resume. That is a
                     different act and every embedding model scores it up.

  SHUFFLE_SECTIONS   Reorder the resume's sentences without changing a word, and compare
                     against the same sentences rejoined in their original order rather than
                     against the untouched resume. Splitting and rejoining flattens line
                     breaks, so without that control this measures reformatting and ordering
                     together. The score should barely move.

  PAD_IRRELEVANT     Add fluent, irrelevant senior-sounding prose. The score should not rise.
                     A rise means length or register is being rewarded over content.

Each perturbation is scored against the same posting as the original, so the comparison is
paired. Intervals come from the cluster bootstrap over postings used everywhere else.

Usage:
    python scripts/behavioral_tests.py
    python scripts/behavioral_tests.py --model models/mpnet-resume-matcher
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Before anything imports huggingface_hub, for the reason service/main.py documents.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.text_utils import (  # noqa: E402
    extract_requirements,
    preprocess_resume,
    smart_truncate_jd,
    split_sentences,
)
from src.train import SEED  # noqa: E402

EXTERNAL = REPO / "Data" / "external_test_200_pairs.csv"
OUT = REPO / "Results" / "behavioral_tests.json"
DEFAULT_MODEL = "dlepighe1/resume-jd-matcher-mpnet"
MAX_WORDS = 350

# Fluent, senior-sounding, and empty. Deliberately not gibberish: a model that ignores random
# characters but rewards confident filler has the failure mode worth finding.
IRRELEVANT_PADDING = (
    "I am a highly motivated professional with a track record of delivering results in "
    "fast-paced environments. I thrive on collaboration and bring strong communication "
    "skills to every team I join. I am passionate about continuous improvement and take "
    "ownership of outcomes from start to finish. Colleagues describe me as dependable, "
    "detail-oriented, and committed to excellence in everything I do."
)

# How much movement counts as a pass. Expressed against the model's own reported mean absolute
# error of about 0.12: an invariance that holds to within a tenth of the model's typical error
# is meaningful, and a drop smaller than that is not worth calling a response.
MEANINGFUL_MOVE = 0.012


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


def load_final_test() -> pd.DataFrame:
    """The same 106 pairs the study reports on, split the way src/train.py splits them."""
    external = pd.read_csv(EXTERNAL)
    _, test = train_test_split(external, test_size=0.5, random_state=SEED,
                               stratify=external["match_type"])
    return test.reset_index(drop=True)


def raw_score(model, resume: str, jd_clean: str) -> float:
    """Cosine under the preprocessing the model was trained with.

    Raw rather than calibrated, deliberately. Platt is monotone, so it cannot change the sign
    of any effect measured here, and reporting raw keeps the perturbation size on the scale
    the model actually operates on.
    """
    embeddings = model.encode([preprocess_resume(resume, MAX_WORDS), jd_clean],
                              show_progress_bar=False, convert_to_numpy=True)
    return float(cosine_similarity([embeddings[0]], [embeddings[1]])[0][0])


def drop_evidence(model, resume: str, jd: str) -> str | None:
    """Remove the resume sentence that best covers the posting's top requirement.

    Uses the model's own notion of "best covering", which is the point: this removes what the
    model itself identified as the evidence, so a score that does not move afterwards is
    reading something other than what it reports reading.
    """
    requirements = extract_requirements(jd, max_items=12)
    sentences = split_sentences(resume)
    if not requirements or len(sentences) < 3:
        return None

    embeddings = model.encode([requirements[0]] + sentences, show_progress_bar=False,
                              convert_to_numpy=True)
    similarities = cosine_similarity([embeddings[0]], embeddings[1:])[0]
    best = int(np.argmax(similarities))
    return " ".join(sentences[:best] + sentences[best + 1:])


def keyword_stuff(resume: str, jd: str, max_terms: int = 15) -> str:
    """Append the posting's distinctive skill TERMS as an unevidenced skills line.

    Terms, not sentences, and the distinction is the whole test. An earlier version of this
    appended the full requirement sentences, which came to roughly 200 words against a median
    resume of 106. That made the perturbed document mostly job description by volume, and it
    duly raised cosine similarity by 0.39. It measured nothing about keyword stuffing: pasting
    the posting into the resume is a different act, and any embedding model would score it up.

    What a person actually does is add a skills line naming tools they cannot evidence. So
    this takes the proper nouns and tool-shaped tokens a keyword scanner would look for
    (Splunk, QRadar, C++, .NET), drops the ones the resume already contains, caps the count so
    the addition stays the size of a real skills line, and adds nothing else.
    """
    requirements = extract_requirements(jd, max_items=12)
    if not requirements:
        return resume

    present = {t.lower() for t in re.findall(r"[A-Za-z0-9+#.]+", resume)}
    candidates: list[str] = []
    for requirement in requirements:
        # Skip the first token of each requirement: it is capitalised because it starts the
        # sentence, not because it is a product name.
        for token in re.findall(r"[A-Za-z0-9+#.]{2,}", requirement)[1:]:
            looks_like_a_tool = token[0].isupper() or any(c in token for c in "+#")
            if not looks_like_a_tool or token.lower() in present:
                continue
            if token not in candidates:
                candidates.append(token)

    if not candidates:
        return resume
    return f"{resume}\n\nSkills: {', '.join(candidates[:max_terms])}"


def reorder(sentences: list[str], order) -> str:
    return " ".join(sentences[i] for i in order)


def shuffle_sections(resume: str, rng) -> tuple[str, str] | None:
    """Return (shuffled, order-preserving control), or None when the resume is too short.

    The control exists because splitting a resume into sentences and rejoining them with
    single spaces is not a no-op: it flattens the line breaks and section structure, which on
    these resumes drops roughly 45 characters of whitespace. Comparing the shuffled version
    against the ORIGINAL would therefore measure reformatting plus reordering together, and an
    earlier version of this test did exactly that and reported the sum as an ordering effect.

    Comparing against the same text rejoined in its original order isolates the ordering.
    """
    sentences = split_sentences(resume)
    if len(sentences) < 3:
        return None
    return reorder(sentences, rng.permutation(len(sentences))), reorder(
        sentences, range(len(sentences)))


def pad_irrelevant(resume: str) -> str:
    return f"{resume}\n\n{IRRELEVANT_PADDING}"


def cluster_bootstrap_mean(values: np.ndarray, postings: np.ndarray, resamples: int,
                           rng) -> list[float]:
    blocks = [np.flatnonzero(postings == p) for p in np.unique(postings)]
    draws = []
    for _ in range(resamples):
        picked = rng.integers(0, len(blocks), size=len(blocks))
        idx = np.concatenate([blocks[k] for k in picked])
        draws.append(float(values[idx].mean()))
    lo, hi = np.percentile(draws, [2.5, 97.5])
    return [round(float(lo), 4), round(float(hi), 4)]


def evaluate(name: str, deltas: list[float], postings: list[str], expectation: str,
             resamples: int, rng) -> dict:
    """Turn a set of per-pair score changes into a pass or fail against a stated expectation.

    The expectation is written before the run, in the module docstring, so this reports
    against a prediction rather than describing whatever happened.
    """
    values = np.array(deltas)
    ci = cluster_bootstrap_mean(values, np.array(postings), resamples, rng)
    mean = float(values.mean())

    if expectation == "decrease":
        passed = ci[1] < -MEANINGFUL_MOVE
        reading = "the score falls when its own cited evidence is removed"
    elif expectation == "no_increase":
        passed = ci[0] < MEANINGFUL_MOVE
        reading = "the score does not rise materially"
    else:  # invariant
        passed = abs(mean) < MEANINGFUL_MOVE and abs(ci[0]) < 0.05 and abs(ci[1]) < 0.05
        reading = "the score is close to unchanged"

    return {
        "test": name,
        "expectation": expectation,
        "n_pairs": len(values),
        "mean_delta": round(mean, 4),
        "ci95": ci,
        "median_delta": round(float(np.median(values)), 4),
        "pairs_moving_wrong_way": int((values > 0).sum() if expectation != "decrease"
                                      else (values >= 0).sum()),
        "passed": bool(passed),
        "_reading": reading,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--resamples", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    if not EXTERNAL.exists():
        sys.exit(f"Missing {EXTERNAL.relative_to(REPO)}")

    from sentence_transformers import SentenceTransformer

    print(f"Loading {args.model} ...")
    model = SentenceTransformer(args.model)
    rng = np.random.default_rng(args.seed)

    test = load_final_test()
    weak = test[test["match_type"].isin(["weak", "hard_negative"])].reset_index(drop=True)
    print(f"{len(test)} final-test pairs, {len(weak)} of them weak or hard negative\n")

    collected: dict[str, dict] = {"deltas": {}, "postings": {}}
    for key in ("drop_evidence", "keyword_stuff", "shuffle_sections", "pad_irrelevant"):
        collected["deltas"][key] = []
        collected["postings"][key] = []

    for n, row in enumerate(test.itertuples(), start=1):
        jd_clean = smart_truncate_jd(row.jd, MAX_WORDS)
        base = raw_score(model, row.resume, jd_clean)

        stripped = drop_evidence(model, row.resume, row.jd)
        if stripped:
            collected["deltas"]["drop_evidence"].append(
                raw_score(model, stripped, jd_clean) - base)
            collected["postings"]["drop_evidence"].append(row.jd)

        reordered = shuffle_sections(row.resume, rng)
        if reordered:
            shuffled, control = reordered
            # Against the order-preserving control, so reformatting cancels out and what is
            # left is the effect of the ordering alone.
            collected["deltas"]["shuffle_sections"].append(
                raw_score(model, shuffled, jd_clean)
                - raw_score(model, control, jd_clean))
            collected["postings"]["shuffle_sections"].append(row.jd)

        collected["deltas"]["pad_irrelevant"].append(
            raw_score(model, pad_irrelevant(row.resume), jd_clean) - base)
        collected["postings"]["pad_irrelevant"].append(row.jd)

        if n % 25 == 0:
            print(f"  perturbed {n}/{len(test)} pairs", flush=True)

    # Keyword stuffing is only meaningful on a resume that should not score well. Adding the
    # posting's own vocabulary to a strong match tests nothing, because the terms are already
    # there and evidenced.
    print(f"  keyword-stuffing {len(weak)} weak and hard-negative resumes", flush=True)
    for row in weak.itertuples():
        jd_clean = smart_truncate_jd(row.jd, MAX_WORDS)
        base = raw_score(model, row.resume, jd_clean)
        collected["deltas"]["keyword_stuff"].append(
            raw_score(model, keyword_stuff(row.resume, row.jd), jd_clean) - base)
        collected["postings"]["keyword_stuff"].append(row.jd)

    expectations = {
        "drop_evidence": "decrease",
        "keyword_stuff": "no_increase",
        "shuffle_sections": "invariant",
        "pad_irrelevant": "no_increase",
    }
    results = [
        evaluate(name, collected["deltas"][name], collected["postings"][name],
                 expectation, args.resamples, np.random.default_rng(args.seed))
        for name, expectation in expectations.items()
    ]

    print(f"\n{'test':<18} {'expected':<13} {'n':>4} {'mean':>9} {'95% CI':>20}  result")
    print("-" * 78)
    for r in results:
        ci = f"[{r['ci95'][0]:+.4f}, {r['ci95'][1]:+.4f}]"
        print(f"{r['test']:<18} {r['expectation']:<13} {r['n_pairs']:>4} "
              f"{r['mean_delta']:>+9.4f} {ci:>20}  {'PASS' if r['passed'] else 'FAIL'}")

    failures = [r["test"] for r in results if not r["passed"]]
    print(f"\n{len(results) - len(failures)}/{len(results)} behavioural expectations hold"
          + (f". Failing: {', '.join(failures)}" if failures else "."))

    payload = {
        "_what": "Interventions on the resume, checking the score responds to requirement "
                 "coverage rather than merely correlating with a label.",
        "_method": (
            "Each perturbation changes exactly one thing about a held-out resume and rescores "
            "it against the same posting, so the comparison is paired. Raw cosine is reported "
            "rather than calibrated, because Platt is monotone and cannot change the sign of "
            "any effect here. Intervals from a cluster bootstrap over postings."
        ),
        "_expectations_were_written_first": (
            "The four directional predictions are stated in this script's docstring and were "
            "fixed before it was run. `keyword_stuff` is the sharpest: the product warns users "
            "that adding unevidenced terms reproduces the pattern hard negatives were built "
            "from, and a rise here would contradict a claim the product makes to users."
        ),
        "_threshold": (
            f"A move counts as meaningful at {MEANINGFUL_MOVE} raw cosine, roughly a tenth of "
            f"the model's reported mean absolute error."
        ),
        "model": args.model,
        "resamples": args.resamples,
        "seed": args.seed,
        "tests": results,
        "all_passed": not failures,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {display_path(Path(args.out))}")


if __name__ == "__main__":
    main()
