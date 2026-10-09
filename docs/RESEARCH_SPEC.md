# Study specification

What this repository is for, what it contains, and what it deliberately does not.

## Scope

This repository holds the study, the data, the model pipeline, and a single demo page for
inspecting the results. The product built on top of the model lives in a separate repository,
[Job-hunterAI](https://github.com/dlepighe1/Job-hunterAI), and is specified there in its
`docs/SPEC.md`.

**What kind of work this is.** An exploration of fine-tuning small sentence-transformers, and
of how to establish whether the result is real. It is not academic research and should not be
read against that standard: there is no novel method, the dataset is small and partly
synthetic, and the contribution is not a finding about the world.

The method commitments below are nonetheless strict, and the two are not in tension. The
modelling is ordinary on purpose. The evaluation is where the effort goes, because that is
the part of this work that transfers to any other project.

The boundary is one HTTP contract. This repository publishes a scoring service. The product
consumes it. Neither imports the other's source.

## Questions this study asks

1. Can a small bi-encoder score resume and job-description fit well enough to be useful, and
   how would we know?
2. Does architecture type matter more than model size at this data scale?
3. Can post-hoc calibration fix the compressed score range that ranking losses produce?
4. Does a purpose-built model beat a frontier language model on the same task?
5. Is any of it better than counting words?
6. Does the requirement-by-requirement explanation shown under the score carry the signal it
   implies, and are the thresholds that produce it defensible?
7. Is the score reading requirement coverage, or is it reading phrasing the data generator
   left behind? Every other question here is correlational, and a model reading the wrong
   thing would answer them all the same way.

Questions 1 to 4 are answered in notebooks 01 to 05. Question 5 is answered in notebook 06,
which also audits the shipped model for name sensitivity. Question 6 is answered in
`scripts/eval_explanations.py`, and was added because the explanation was the last
user-facing output in the project with no evaluation behind it. Whether any of the resulting
gaps are larger than sampling noise is settled separately, in `scripts/significance.py`,
because a notebook that reports a difference is not the same as a notebook that has tested
one.

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
- **A p-value is not a result until the family it belongs to is counted.** Comparisons
  reported together are Holm-corrected, with the pre-registered hypotheses separated from
  the exploratory comparisons that accompany them, and with rows that are algebraic
  restatements of another row excluded from the count rather than inflating it. Both the raw
  and the adjusted value are published, so the cost of the correction is visible. Adopting
  this cost the study two of the three conclusions its loss ablation had reported.
- **A null result is not a result until its power is stated.** Every comparison carries the
  smallest effect it could have detected, a two-one-sided-tests verdict against a margin
  equal to the project's own measured run-to-run spread, and where relevant the number of
  postings that would settle it. "We did not detect a difference" and "there is no
  difference" are separate claims and are labelled separately.
- **Thresholds are fitted where calibrators are fitted.** Any constant that shapes an output
  is selected on the calibration half and reported on the final test half. The skill-gap
  thresholds were hand-picked for most of this project's life and were measurably wrong when
  finally tested.
- **Negative results stay in.** Four anti-overfitting fixes that did not work are reported at
  the same length as the approach that did, and so is one ablation that turned out to measure
  nothing at all.
- **Known weaknesses are quantified, not softened.** The model's systematic underprediction of
  strong matches, the demographic name-substitution result, and the calibration split's
  posting overlap are each given a number rather than a reassurance.
- **The limits of the evidence are separated from the limits of the analysis.** Synthetic
  labels mean this study measures fidelity to a rubric rather than to job fit, and that is a
  property of the data that no statistical care repairs. `docs/VALIDATION_ROADMAP.md` states
  what would repair it, what each step costs, and what each step would license the project to
  claim, so the limitation is a plan rather than a disclaimer.

## Deliverables

| Artifact | Location |
|---|---|
| Seven notebooks in study order | `Notebooks/` |
| Training and external test data | `Data/` |
| Data card | `docs/DATA_CARD.md` |
| All metrics, transcribed from executed cells | `Results/results_summary.json` |
| Which differences survive resampling and correction | `Results/significance.json` |
| The pre-registered loss ablation, corrected | `Results/loss_ablation_significance.json` |
| Whether the explanation carries signal | `Results/explanation_eval.json` |
| Whether the synthetic resumes copy their postings | `Results/generation_artifacts.json` |
| Whether the score responds to coverage causally | `Results/behavioral_tests.json` |
| Serving-cost study, designed and scaffolded | `docs/EFFICIENCY_STUDY.md` |
| Bias and baseline audit | `Results/audit_results.json` |
| Reproduction script, with recorded environment | `src/train.py` |
| How to cite the study | `CITATION.cff` |
| What the evidence cannot support, and the costed plan for fixing it | `docs/VALIDATION_ROADMAP.md` |
| Scoring service | `service/` |
| Demo page | `web/` |

## Out of scope

Authentication, persistence, application tracking, outreach, billing, and anything with a
user account. All of it belongs to the product repository. If a change here would only make
sense for a product, it belongs there instead.
