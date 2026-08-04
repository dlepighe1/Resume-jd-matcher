# Research specification

What this repository is for, what it contains, and what it deliberately does not.

## Scope

This repository holds the study, the data, the model pipeline, and a single demo page for
inspecting the results. It is research. The product built on top of the model lives in a
separate repository, [Job-hunterAI](https://github.com/dlepighe1/Job-hunterAI), and is
specified there in its `docs/SPEC.md`.

The boundary is one HTTP contract. This repository publishes a scoring service. The product
consumes it. Neither imports the other's source.

## Research questions

1. Can a small bi-encoder score resume and job-description fit well enough to be useful, and
   how would we know?
2. Does architecture type matter more than model size at this data scale?
3. Can post-hoc calibration fix the compressed score range that ranking losses produce?
4. Does a purpose-built model beat a frontier language model on the same task?
5. Is any of it better than counting words?

Questions 1 to 4 are answered in notebooks 01 to 05. Question 5 is answered in notebook 06,
which also audits the shipped model for name sensitivity. Whether any of the resulting gaps
are larger than sampling noise is settled separately, in `scripts/significance.py`, because a
notebook that reports a difference is not the same as a notebook that has tested one.

## Method commitments

These are the rules the study holds itself to. Several were adopted after a failure.

- **Every reported number comes from job postings the model never trained on.** Internal test
  numbers appear only as diagnostics, and notebook 03 exists to show how far they mislead.
- **Calibrators are fitted on a separate split from the one used for reporting.** The 212
  external pairs divide into 106 for calibration and 106 for the final test.
- **Production numbers are means across three seeds with bootstrap confidence intervals.**
  Notebook 02 documents a single run of one configuration swinging roughly 0.28 Spearman, so
  single-run numbers are not reported as results.
- **Metrics describe the artifact that ships.** Notebook 05 reloads the saved checkpoint
  before calibrating, because `fit()` saves the best-by-validation checkpoint while leaving
  the final epoch in memory. Getting this wrong once published a model that did not match its
  own published metrics.
- **Guards, not vigilance.** Four automated checks enforce the point above: the training
  notebook verifies its own publication, the audit notebook refuses to run against a
  mismatched model, the demo data pipeline refuses to bundle predictions that disagree with
  the recorded metrics, and `tests/test_results_consistency.py` fails if any published number
  drifts from the artifact it was copied from.
- **A difference is not a result until it is resampled.** Comparisons between engines are
  reported with a paired bootstrap interval and a p-value, never as two point estimates side
  by side. The resampling unit is the posting rather than the pair, because four candidates
  drawn from one posting are not four independent observations.
- **Negative results stay in.** Four anti-overfitting fixes that did not work are reported at
  the same length as the approach that did, and so is one ablation that turned out to measure
  nothing at all.
- **Known weaknesses are quantified, not softened.** The model's systematic underprediction of
  strong matches, the demographic name-substitution result, and the calibration split's
  posting overlap are each given a number rather than a reassurance.

## Deliverables

| Artifact | Location |
|---|---|
| Six notebooks in study order | `Notebooks/` |
| Training and external test data | `Data/` |
| Data card | `docs/DATA_CARD.md` |
| All metrics, transcribed from executed cells | `Results/results_summary.json` |
| Which differences survive resampling | `Results/significance.json` |
| Bias and baseline audit | `Results/audit_results.json` |
| Reproduction script | `src/train.py` |
| Scoring service | `service/` |
| Demo page | `web/` |

## Out of scope

Authentication, persistence, application tracking, outreach, billing, and anything with a
user account. All of it belongs to the product repository. If a change here would only make
sense for a product, it belongs there instead.
