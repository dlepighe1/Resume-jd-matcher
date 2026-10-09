# Validation roadmap: from a labelling rubric to job fit

**The question this document exists to answer.** Every number in this repository measures how
faithfully a model reproduces a scoring rubric that this project wrote. That is not the same
as measuring whether it predicts job fit, and no amount of methodological care closes the
gap, because the gap is in the labels rather than in the analysis. This is the plan for
closing it, written so it can be picked up cold.

It is ordered by value per unit of effort, and each tier states what it would let the project
claim that it currently cannot.

---

## 0. First, be precise about the target

"Job fit" is not one variable. Four candidates are usually conflated, and they differ enough
that choosing between them is the first decision, not a detail:

| Target | Obtainable? | What predicting it would mean |
|---|---|---|
| Expert judgment: would a recruiter shortlist this candidate? | Yes, at a cost | The model agrees with people who do this professionally |
| Screening outcome: did the application get a callback? | Only from an employer or an ATS | The model predicts a real decision, including its biases |
| Hiring outcome: was an offer made? | Effectively closed | As above, further downstream and noisier |
| Job performance: did they succeed in the role? | No | The thing "fit" actually means |

Job performance is unmeasurable here and largely unmeasurable anywhere. Performance is
observed only for people who were hired, which is selection bias by construction, and the
counterfactual does not exist.

Screening and hiring outcomes encode the behaviour of the process that produced them. A model
that predicts them well reproduces recruiter behaviour, including its failures. That is a
legitimate scientific target and a hazardous deployment target, and the two must not be
confused in any copy this project produces.

**So the honest ceiling, even with perfect data, is "predicts expert judgment on this
distribution", not "predicts fit."** Everything below is aimed at that ceiling. Saying so
plainly is part of the deliverable.

---

## 1. The structural insight that makes this affordable

**Real labels are needed for validation, not for training.**

Training on synthetic labels and validating against expert judgment is a standard weak
supervision design. If a model trained on this rubric ranks candidates the way experts rank
them, two things are established at once: the model works, and the rubric was a defensible
proxy. If it does not, that is a more valuable finding than another 0.02 Spearman.

This changes the cost profile entirely. Labels at training scale means thousands of pairs and
is out of reach for one person. Labels at validation scale means a few hundred, and that is a
weekend and a few hundred dollars.

Nothing below requires retraining the model.

---

## Tier 0. Costs nothing, do it first

**Status: done.** `scripts/audit_generation_artifacts.py` and `scripts/behavioral_tests.py`,
reporting to `Results/generation_artifacts.json` and `Results/behavioral_tests.json`. Findings
are summarised in the README. The design below is kept because it is the reasoning, and
because a re-run on new data should follow it.

These need no new data and bound how much the later tiers can possibly be worth. If tier 0
finds a problem, the expensive tiers are measuring an artifact.

### 0.1 Test for generation artifacts

**The risk.** The resumes are synthetic and were written against the real postings. A "strong
match" resume may therefore share phrasing with its posting in ways a real resume never
would. If so, some portion of the reported 0.82 Spearman is style matching rather than skill
matching, and external validation cannot detect it, because the training and external halves
carry the same artifact.

**The test.** Compare the distribution of lexical overlap between resume and posting for
synthetic pairs against the same statistic on even 20 real resume/posting pairs, holding
match quality roughly constant. Character n-gram overlap and rare-term sharing are more
diagnostic than plain token overlap, because a generator reuses distinctive phrasing.

**What it would change.** A sharp difference does not invalidate the study, but it caps every
claim and belongs in the data card. `docs/DATA_CARD.md` covers provenance, splits and rubric
limits thoroughly and does not currently address this.

### 0.2 Behavioural tests of the construct

**The risk.** The score is claimed to track requirement coverage. That claim rests entirely on
correlation with a synthetic label and has never been tested by intervention.

**The tests.** Take held-out strong pairs and perturb one thing at a time:

- Delete the single most important required skill from the resume. The score must drop.
- Add years of unrelated seniority. The score should move very little.
- Add the posting's key terms to a weak resume without any evidence behind them. The score
  must not rise. Hard negatives in training were built for exactly this, so a failure here
  would be a direct contradiction of the training design.
- Reorder resume sections without changing content. The score should be near-invariant.

**Why this is worth doing.** These are causal statements about the model, not correlational
ones, and they need no labels. `Notebooks/06` already runs the name-substitution version of
this idea; the skill-perturbation version is more central to the product claim and is absent.

**Effort:** a few hours each. Both fit the existing test and artifact conventions.

---

## Tier 1. The unlock: an expert pairwise validation set

This is the tier that changes the category of the project. Everything else is a refinement.

### 1.1 Design

**Ask for comparisons, not scores.** For a given posting, show two candidates and ask which is
the better fit. Humans are unreliable at absolute ratings and reliable at forced choice, and
absolute scoring is the metric this model is weakest at anyway. Pairwise choice maps directly
onto precision@1, which is already the project's most defensible number.

**Sizing, using the external set that already exists.** 53 postings with 4 candidates each
gives 6 pairs per posting, so 318 comparisons. Three raters produces roughly 950 judgments and
about 10 hours of total rater time.

**Recruiting raters.** Prolific with a screener for recruiting or hiring-manager experience is
the practical route, at a few hundred dollars. Personal network hiring managers work and are
cheaper but risk a narrower professional distribution. Record which population was used,
because it bounds generalization.

**Blinding.** Raters must not see the model's score, the match-type label, or the order the
generator produced. Randomize candidate order within each pair and pair order within each
rater's set.

### 1.2 The headline is inter-rater agreement, not the model

**Report the human agreement ceiling first.** If three recruiters agree with each other at 0.6
Spearman, then 0.6 is the noise ceiling for this task, and a model scoring 0.82 against a
synthetic rubric is not comparable to anything. Use Krippendorff's alpha for the ordinal case
and pairwise agreement rate for the forced-choice case.

This single number reframes the project. It says what "good" means on this task, it is almost
never published in this space, and it is plausibly a more interesting contribution than the
model. It also protects against the failure mode where a model is criticized for missing a
target that humans cannot hit either.

### 1.3 Analysis

The statistical machinery already in this repository applies unchanged: cluster bootstrap over
postings, Holm correction within families, equivalence tests against a stated margin, and the
minimum detectable effect. It is currently spent on a target the project invented. Pointed at
expert agreement with a stated noise ceiling, the same machinery becomes the point.

Pre-register the hypothesis and the predicted mechanism before collecting, as `Notebooks/07`
did. The prediction worth committing: the model's agreement with experts will land below the
inter-rater ceiling but above TF-IDF's agreement with experts.

### 1.4 What it would let the project claim

> The model's ranking agrees with professional judgment at X, against a human-to-human
> agreement ceiling of Y, on postings it never trained on.

That is a sentence about the world rather than about a rubric.

---

## Tier 2. Real resumes

**The gap.** The model has only ever seen synthetic resume prose. Whether it transfers to real
resumes, with their formatting debris, inconsistent tense, abbreviations and gaps, is untested
and is a distribution shift the current design cannot see.

**The test.** Score real resumes against the existing 53 external postings and compare score
distributions and requirement-coverage rates against the synthetic ones. No labels needed for
the distributional check; combine with tier 1 if the same resumes get expert judgments.

**Sources, in order of preference.** Anonymized volunteer resumes from your own network,
with explicit consent and no storage beyond the study. Public resume corpora exist but carry
murky licensing and real PII, and should be treated as a last resort with the licence
recorded in the data card.

**What it would let the project claim.** That the reported numbers survive contact with the
kind of document the product actually receives.

---

## Tier 3. Outcome data, through the product

**The insight.** `Job-hunterAI` is already the instrument. Its `applications` table stores a
score at application time and a status that later becomes `rejected`, `interview` or `offer`.
That is a score-to-outcome dataset accumulating for free, and it is the only realistic path
from expert judgment to a real decision.

**Confounds, to be named in advance rather than discovered.**

- **Range restriction.** Users apply where they believe they fit, so the observed score range
  is truncated and correlations will be attenuated.
- **Missing not at random.** Ghosting is the most common outcome and is not "rejected". It
  must be modelled as its own category, never dropped.
- **Self-report.** Statuses are entered by the user, with the errors that implies.
- **Tiny per-user n**, so any model has to pool across users while accounting for the fact
  that one user's applications are correlated. The posting-level cluster bootstrap in this
  repository is the right starting point and the unit becomes the user.

**Ethics and consent.** This is human-subjects-adjacent research on personal data. Analysis
requires explicit opt-in, separate from the product's terms of service, with the purpose
stated and withdrawal possible. Aggregate reporting only. Nothing here justifies using a
user's data because they happened to sign up for a job tracker.

**What it would let the project claim.** That the score carries signal about screening
outcomes, with the confounds above stated, on a dataset nobody else has.

---

## Summary: what each tier buys

| Evidence available | What may then be claimed |
|---|---|
| Today | The model reproduces a labelling rubric on unseen postings |
| Tier 0 | The score tracks skill coverage rather than surface style, and is not an artifact of how the data was generated |
| Tier 1 | The ranking agrees with expert judgment at X, against a human ceiling of Y |
| Tier 2 | That holds on real resumes, not only synthetic ones |
| Tier 3 | The score carries signal about screening outcomes, with stated confounds |

Tier 1 is the row that changes what kind of project this is, and it is within reach of one
person with a few hundred dollars and a weekend.

---

## What this roadmap does not promise

It does not lead to a model that predicts who will succeed in a job. That target is not
reachable from any data described here, and a project that claimed otherwise would be making
exactly the kind of unsupported leap this repository exists to avoid making.
