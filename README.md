# ResumeAI: Resume and Job Description Matching

[![tests](https://github.com/dlepighe1/Resume-jd-matcher/actions/workflows/tests.yml/badge.svg)](https://github.com/dlepighe1/Resume-jd-matcher/actions/workflows/tests.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A fine-tuned sentence-transformer that scores how well a resume fits a job description on a
calibrated 0 to 1 scale, explains which requirements are covered, and generalizes to job
postings it has never seen.

![Every engine on the same 106 held-out pairs, with bootstrap intervals: the fine-tuned model
at 0.816, Claude Opus 4.5 at 0.712, base MPNet at 0.625, TF-IDF at
0.566](docs/images/demo-benchmark.jpg)

*Every engine scored on the identical 106 held-out pairs, with 95% bootstrap intervals. The
demo page lets you filter to the cases you care about and read the resume and posting behind
any point, including the ones the model gets wrong.
[Run it locally](#running-the-demo-page).*

**In one minute**

- **What it is.** A hands-on exploration of fine-tuning small sentence-transformers, and of
  how to tell whether the result is real. Not a paper, not a product. The model is the
  vehicle; the evaluation is the subject.
- **The headline.** The model picks the right candidate first for **84.9% of 53 unseen job
  postings**, where guessing gets 25%, at 109M parameters. It outranks Claude Opus 4.5 on the
  same pairs.
- **The interesting part.** The best model on the internal test set scored **0.89 there and
  -0.61 on unseen postings**, ranking good candidates below bad ones. It had memorised its
  training postings. Finding that changed every decision afterwards.
- **The part most projects skip.** When the comparisons were corrected for how many were run,
  two of this project's own published conclusions did not survive, and they were rewritten
  rather than quietly kept. A power analysis then showed one of them was never answerable with
  the data available.
- **The honest limit.** The match labels are synthetic, so this measures fidelity to a scoring
  rubric rather than to job fit. [What that means, and the costed plan for fixing
  it](docs/VALIDATION_ROADMAP.md).

Start with [the study](#the-study) for the narrative, or
[what this does and does not answer](#what-this-study-answers-and-what-it-does-not) for the
short version of the limits.

---

## What this repository is

An exploration, written up carefully. It fine-tunes small bi-encoders on a resume-matching
task, compares architectures, and then spends most of its effort on the harder question of
whether any of the resulting numbers mean anything.

It is deliberately **not** framed as academic research, and it should not be read against
that standard. There is no novel method here, the dataset is small and partly synthetic, and
the contribution is not a finding about the world. What it is instead is a record of a model
being built and then interrogated: external validation, calibration, resampling, multiplicity
correction, equivalence testing, a bias audit, behavioural probes, and a documented defect in
its own release process.

The reason the evaluation is held to a high standard while the framing is modest is that the
evaluation is the point. Anyone can fine-tune MPNet in an afternoon. Knowing whether the
resulting number survives contact with unseen data, with a correction for how many
comparisons were run, and with an honest account of what the labels can support, is the
skill this repository is about.

It contains the study, the data, the model pipeline, and a single demo page for inspecting
the results.

**Current model:** `all-mpnet-base-v2` fine-tuned with a combined ranking and calibration
objective, plus Platt score calibration. Measured across three seeds on 106 fully held-out
pairs from unseen job postings:

| Metric | Value |
|---|---|
| Precision@1 across 53 unseen postings | **84.9%** (45/53), Wilson 95% CI [73%, 92%], against a 25% random baseline |
| Spearman correlation | **0.8273 ± 0.0236** across three seeds |
| Mean absolute error | **0.1194 ± 0.0113**, Platt calibrated, the configuration that ships |
| Production seed (43) | 0.8163 Spearman, 95% CI [0.740, 0.864] |
| Against base MPNet | 0.6246, so fine-tuning contributes **+0.192 Spearman**, 95% CI [+0.108, +0.292] |
| Against Claude Opus 4.5 | **+0.105 Spearman**, 95% CI [+0.020, +0.212], p = 0.012, at 109M parameters |
| Against TF-IDF | **+0.251 Spearman**, 95% CI [+0.124, +0.404] |

Every gap above is tested rather than asserted. A paired bootstrap that resamples postings
rather than pairs separates the model from base MPNet, from TF-IDF, from word overlap, and
from Claude Opus 4.5. All six comparisons form one family and all six survive
Holm-Bonferroni correction, including the narrowest of them: the Claude gap is the family's
largest p-value, so its adjusted value is also 0.012. See
[`Results/significance.json`](Results/significance.json).

The `±` is seed-to-seed spread within one run. Three runs of this identical recipe have
produced aggregate Spearman of 0.8273, 0.8355 and 0.8447, so there is roughly 0.017 of
run-to-run spread on top of it that no interval here includes. Every difference reported as
significant in this repository is larger than that, so no conclusion depends on it, but the
headline above is the lowest of the three runs. See
[Reproducibility](#the-run-is-not-bit-reproducible).

> **Verified.** The published checkpoint was re-downloaded and re-scored before these numbers
> were accepted: it reproduces the run's raw Spearman of 0.8163. Two earlier runs published a
> model that did not match its own metrics, which is why this check now exists and why
> `published_verified` is recorded in the results file. See
> [A defect worth documenting](#a-defect-worth-documenting).

| | |
|---|---|
| Full metrics | [`Results/results_summary.json`](Results/results_summary.json) |
| Research notebooks | [`Notebooks/`](Notebooks/), 01 to 05 in story order, plus an audit and an ablation |
| Data card | [`docs/DATA_CARD.md`](docs/DATA_CARD.md) |
| Scope of this repo | [`docs/RESEARCH_SPEC.md`](docs/RESEARCH_SPEC.md) |
| What this study cannot yet claim, and the plan for it | [`docs/VALIDATION_ROADMAP.md`](docs/VALIDATION_ROADMAP.md) |
| Product built on this model | [Job-hunterAI](https://github.com/dlepighe1/Job-hunterAI), a separate repository. Its spec lives there |
| Significance testing | [`Results/significance.json`](Results/significance.json), `python scripts/significance.py` |
| Loss ablation | [`Results/loss_ablation_significance.json`](Results/loss_ablation_significance.json), pre-registered, `--ablation` |
| Explanation evaluation | [`Results/explanation_eval.json`](Results/explanation_eval.json), `python scripts/eval_explanations.py` |
| Are the synthetic resumes copied from the postings | [`Results/generation_artifacts.json`](Results/generation_artifacts.json), `python scripts/audit_generation_artifacts.py` |
| Does the score respond to coverage causally | [`Results/behavioral_tests.json`](Results/behavioral_tests.json), `python scripts/behavioral_tests.py` |
| Serving cost, designed and scaffolded | [`docs/EFFICIENCY_STUDY.md`](docs/EFFICIENCY_STUDY.md), `python scripts/benchmark_inference.py` |
| Reproduce | `python src/train.py` |
| Tests | 283, all offline: no model downloads, no API calls. Linted and run on every push |

---

## The study

The interesting part of this project is not the final number. It is what went wrong in the
middle and how the evidence changed the design.

### 1. Baseline fine-tuning (`Notebooks/01`)

Three bi-encoders (MiniLM, MPNet, BGE) fine-tuned on 500 curated pairs drawn from 150 real
job postings, using CoSENT loss. Stratified 80/10/10 splits, baselines measured before
training, per-match-type error analysis.

MPNet roughly doubled its ranking quality, from 0.3682 to 0.8444 Spearman. Every model's
mean absolute error got *worse*. That contradiction is the subject of the next notebook.

### 2. Architecture study (`Notebooks/02`)

Compared a classic bi-encoder (MPNet), an instruction-aware bi-encoder (E5), a RoBERTa
cross-encoder, and a two-stage hybrid.

The finding is the **calibration gap**. CoSENT-trained bi-encoders rank well but compress
every score into roughly 0.5 to 0.9, because any two English documents share a cosine
similarity floor. Isotonic regression cut mean absolute error by about 38% for both
bi-encoders without retraining.

This notebook also produced the project's most useful accident. Fine-tuned MPNet scores
0.5691 here, 0.8444 in notebook 01, and 0.8516 in notebook 03, under an identical
configuration. Training was never seeded, and at 400 examples a single run swings roughly
0.28 Spearman. The notebook documents this in a caveat cell rather than hiding it, and it is
why the production run reports mean and standard deviation across three seeds.

### 3. External validation (`Notebooks/03`)

Built a 212-pair external test set from 53 job postings the models had never seen. Zero JD
overlap, asserted in code rather than assumed. Added job description preprocessing that
strips EEO and benefits boilerplate and prioritizes the requirements section.

The RoBERTa cross-encoder was the best model on the internal test at 0.8917 Spearman. On
unseen postings it scored **-0.6122**: not merely worse, but anti-correlated, ranking good
candidates below bad ones. It had memorized the 150 training postings. At 125M parameters
over 400 training examples, that is roughly 312,000 parameters per example.

Across the identical transfer, the calibrated bi-encoder lost 0.076 Spearman and held at
0.7614.

Internal test sets drawn from the same job postings as training will flatter the largest
model available. External validation was the only thing that caught this.

### 4. Systematic fixes, and a negative result (`Notebooks/04`)

Ablated four anti-overfitting fixes on the cross-encoder: 3x data augmentation, weight decay,
a smaller DistilRoBERTa backbone, and a 5-fold ensemble. Every fix helped, moving external
Spearman from -0.35 to +0.51. None of them beat the simple calibrated bi-encoder at 0.77.

At this data scale, cross-encoder capacity is a liability rather than an asset.

### 5. Production (`Notebooks/05`)

Acted on the evidence rather than the leaderboard:

- **70% more unique postings.** 815 pairs from 255 postings, up from 500 pairs from 150.
- **Combined loss.** CoSENT for ranking plus CosineSimilarity for absolute score, on the
  reasoning that the model should receive gradient signal in both directions. This was the
  one design choice here that was reasoning rather than evidence. `Notebooks/07` has since
  tested it, and **the reasoning did not survive**: after calibration the CosineSimilarity
  term contributes nothing measurable and can be dropped. See section 7.
- **Calibration fitted on external data.** The 212 external pairs split 106 for calibration
  and 106 for the final test. Every reported number comes from the untouched half.
- **Production discipline.** Three seeds reported as mean and standard deviation, a
  base-model baseline on the same held-out pairs, bootstrap 95% confidence intervals, and
  precision@1 across the unseen postings.

#### The run is not bit-reproducible

`set_seed()` covers `random`, `numpy`, `torch`, `torch.cuda`, and sets `cudnn.deterministic`.
That is not enough for bit-reproducibility, and the README used to imply otherwise. `fit()`
runs with `use_amp=True`, and the gradient scaler adapts to observed overflows, so re-running
an identical config gives slightly different weights. The cross-encoder in the same notebook,
which does not use AMP, reproduced bit-for-bit across runs. Dropping AMP would buy exact
reproducibility at roughly twice the training time. The three-seed protocol exists precisely
because the run is not deterministic.

Notebook 07 measured how much this costs, because its `combined` arm re-runs this exact
recipe as a control:

| Run of the identical recipe | Aggregate Spearman | Seed 43 alone |
|---|---|---|
| Notebook 05, first run | 0.8355 ± 0.0144 | |
| Notebook 05, published run | 0.8273 ± 0.0236 | 0.8163 |
| Notebook 07, `combined` arm | 0.8447 ± 0.0143 | 0.8314 |

Same 815 pairs, same `split_seed`, same seeds, same PyTorch 2.11.0+cu128, same Tesla T4, and
notebook 07 verified its test-split fingerprint against notebook 05's before training. So the
spread is not environment drift and not a different split. A fixed seed moves the result by
about 0.015, and the three-seed aggregate moves by about 0.017 between runs.

The consequence is stated rather than buried: the published `±` is within-run seed spread and
does not include this. Every difference this study calls significant is several times larger
than 0.017, so nothing in the conclusions turns on it, and the published headline happens to
be the lowest of the three runs.

Results on the 106-pair final test:

| Model | Spearman | MAE |
|---|---|---|
| **MPNet + Platt calibration (production)** | **0.8163** | **0.1270** |
| MPNet + isotonic calibration | 0.8079 | 0.1222 |
| MPNet raw (combined loss) | 0.8163 | 0.1797 |
| DistilRoBERTa cross-encoder (augmented, regularized) | 0.7586 | 0.1939 |
| Base MPNet, no fine-tuning | 0.6246 | 0.2138 |

Raw and Platt share a Spearman because Platt scaling is a strictly increasing sigmoid and
Spearman depends only on ranks. Calibration cannot move the ranking, which is the point: the
ordering was already good and only the score values were compressed. MAE falls from 0.180 to
0.127, a 29% reduction. Isotonic differs slightly because its flat segments create ties, and
ties do change ranks.

The two calibrators are statistically tied. A 2,000-resample bootstrap on the difference in
mean absolute error gives a 95% interval of [-0.0037, +0.0140], which straddles zero. Platt
ships on a robustness argument rather than a metric win: a two-parameter sigmoid cannot
overfit a 106-pair calibration split, while an isotonic step function can.

Across three seeds the model spans 0.8055 to 0.8600 Spearman. That spread is a property of
training at this data scale and is the reason single-run numbers are not quoted.

### 6. Model audit (`Notebooks/06`)

Building a model is not the same as knowing whether to trust it. The audit notebook loads the
published model and asks four questions the training notebooks cannot:

- **Is it beating TF-IDF?** Every comparison so far has been neural against neural. A
  109M-parameter model that ties a bag-of-words baseline is overhead rather than a result.
- **Does the score move when only the candidate's name changes?** Each held-out resume is
  re-scored with 18 substituted names drawn from the standard resume-audit literature, holding
  every skill, date, and employer constant.
- **Does the job description preprocessing actually help?** Asserted throughout this
  repository, never tested until now.
- **Where is calibration weakest?** A reliability diagram, because mean absolute error is an
  average and averages hide shape.

It runs on CPU in about 15 minutes, and its guard cell refuses to proceed if the model it
loads disagrees with `production_results.json`.

**Is it beating word counting?** Yes, and by more than noise. On the identical held-out pairs:
word overlap 0.5593, TF-IDF 0.5656, base MPNet 0.6246, fine-tuned 0.8163. The gap over TF-IDF
is +0.251 with a 95% interval of [+0.124, +0.404].

**Does the name matter?** Marginally, and the honest answer needs both halves. Substituting 18
names across six demographic groups while holding every skill, date, and employer constant
moves group means by 0.0054 and flips 3 of 106 verdict bands. The direction of the largest gap
is consistent enough to be statistically detectable, and its size is roughly a twentieth of the
model's own average error. This tests names only; school, address, and employment gaps also
correlate with demographics and this audit would not catch sensitivity to those.

**Does the preprocessing help?** *This ablation failed to test anything, and is reported
anyway.* Raw job descriptions and naively truncated ones scored identically to four decimal
places, because every external posting already falls under the 350-word cut and the naive arm
never truncated. Against raw text the production smart truncation is 0.0021 worse on Spearman
and 0.0017 better on MAE, which is noise. Settling this needs a posting set that is actually
long enough to truncate, and a model trained on raw text to separate the method from
train/serve consistency.

**Where is calibration weakest?** Expected calibration error is 0.031, but the error has a
direction. Strong matches carry a bias of -0.166, meaning every one of the 27 strong pairs is
underscored, and weak matches +0.091. The model compresses toward the middle of the scale and
never predicts above 0.852 while labels reach 0.945. Ranking is unaffected, which is why
precision@1 holds at 84.9% while absolute error on strong pairs is the worst of any group.
The practical consequence: read the output as a ranking signal, not as a percentage fit.

### 7. The combined loss does not earn its place (`Notebooks/07`)

Notebook 05 trains with `CoSENTLoss` and `CosineSimilarityLoss` together. Notebooks 01 to 04
use CoSENT alone. That made the combined objective the one architectural decision separating
the production model from the exploratory study, and it was asserted rather than tested. Four
cross-encoder fixes that did not work were ablated; the thing that shipped was not.

It has now been tested, and it lost.

**Every arm gets two dataloaders on purpose.** `fit()` runs one backward pass per objective
per step, so a two-objective arm receives twice the gradient updates of a one-objective arm.
Comparing them directly would confound the loss with twice the optimisation, and a win for
the combined arm might be nothing more than a longer schedule. Matching the objective count
holds steps, data exposure, and warmup identical so that only the loss differs.

| Arm | Objective 1 | Objective 2 | Spearman (Platt) | MAE (Platt) |
|---|---|---|---|---|
| `cosent` | CoSENT | CoSENT | **0.8477 ± 0.0239** | **0.1078 ± 0.0078** |
| `cosine` | CosineSimilarity | CosineSimilarity | 0.8045 ± 0.0092 | 0.1261 ± 0.0090 |
| `combined` | CoSENT | CosineSimilarity | 0.8447 ± 0.0143 | 0.1110 ± 0.0079 |

Three seeds per arm, on the identical 106-pair final test, whose fingerprint the notebook
verified against notebook 05's published split before spending any GPU time. The verdict
comes from the same paired cluster bootstrap used everywhere else in this repository.

The ablation computed ten comparisons. Four are algebraic restatements of another row,
because Spearman depends only on ranks and Platt is a strictly increasing sigmoid, so an
arm's raw and calibrated Spearman are one number rather than two measurements. The rest
divide into the hypothesis notebook 07 registered in advance and the comparisons that came
along with it, and each family is Holm-corrected on its own:

| Comparison against `combined` | Difference | 95% CI | p | p adjusted | Family |
|---|---|---|---|---|---|
| `cosent`, Spearman | +0.0024 | [-0.027, +0.037] | 0.89 | 0.89 | primary |
| `cosent`, MAE | +0.0061 | [-0.005, +0.016] | 0.27 | 0.54 | primary |
| `cosine`, MAE | -0.0158 | [-0.028, -0.004] | 0.007 | **0.033** | secondary |
| `cosine`, Spearman | +0.0458 | [+0.008, +0.088] | 0.020 | 0.079 | secondary |
| `cosent` 3-seed ensemble, Spearman | -0.0257 | [-0.048, -0.004] | 0.021 | 0.079 | secondary |

**One comparison survives correction, and it is not the headline one.** Everything below
follows from that, and an earlier version of this section overstated all three of its
conclusions by reading five raw p-values as five independent results.

**H1 is supported weakly, not established.** CoSENT alone is not separable from the combined
objective on either metric, which is what H1 predicted. But a non-significant difference is
not a demonstrated tie, and this study now tests for one directly. Equivalence is judged
against the margin the project already measured on itself: re-running the identical recipe
moves aggregate Spearman by 0.0174 and MAE by 0.0084, so a difference smaller than that
cannot be acted on because the next run would erase it. Neither primary comparison clears
it. The 90% intervals are wider than the margin, so the honest verdict is inconclusive.

**What it would take to settle it is now stated rather than left open.** At 80% power these
106 pairs from 50 postings can detect 0.0452 Spearman and 0.0152 MAE. Both are larger than
the margin they would need to rule out, which is the whole problem. Resolving H1 at the
project's own noise floor needs roughly 338 postings for Spearman and 164 for MAE, against
the 50 available. The experiment was underpowered for the question it asked, and it took a
power calculation rather than a p-value to notice.

**CoSENT is still load-bearing, on one metric.** Replacing it with CosineSimilarity costs
0.0158 MAE, adjusted p = 0.033, and that is the only conclusion in the ablation that
survives its family correction. The 0.0458 Spearman cost points the same way but does not
clear the bar on its own, so the claim is now "replacing CoSENT hurts calibration" rather
than "replacing CoSENT hurts both".

**The asymmetry between the arms is still what makes the result informative**, and it is
weaker than it looked. Dropping CosineSimilarity costs nothing detectable; replacing CoSENT
costs something detectable on MAE. That asymmetry is real. What cannot be claimed is that
the first half of it is a demonstrated equivalence.

**All three pre-registered predictions held, including the mechanism.** The hypothesis was
committed before any run existed. CoSENT is rank-based and scale-free, so it should rank well
and calibrate badly; CosineSimilarity is MSE against the label, so it should do the reverse.
Before any calibrator runs, that is exactly the picture: `cosent` ranks best at 0.8477 and
calibrates worst at MAE 0.2199, while `cosine` calibrates best at 0.1486 and ranks worst at
0.8045. The sharper prediction was that Platt would erase the difference, because an oracle
calibrator fitted directly on the test set left only 0.019 MAE recoverable beyond Platt. It
did: after calibration the two land at 0.1078 and 0.1261. The magnitude information the
CosineSimilarity term supplies is information a two-parameter sigmoid already recovers for
free.

**The seed ensemble was the recommendation that correction cost most.** Averaging the raw
cosines of all three CoSENT runs reaches 0.8639, and at a raw p of 0.021 it read as the one
upgrade the evidence supported. Adjusted within its five-member exploratory family it lands
at 0.079 and does not survive. It uses every run, so nothing is cherry-picked, unlike
quoting the best single seed at 0.8810, and its direction is consistent. It is now recorded
as a promising exploratory result rather than an evidenced one, and settling it needs
roughly 161 postings.

**What ships, and why it does not change today.** The production checkpoint stays as it is.
Reshipping for an indistinguishable +0.0024 would violate the standard this repository
applies to everything else, and that argument is unchanged. What did change is the claim
attached to it: dropping the CosineSimilarity term is supported by a failure to detect a
difference, not by a demonstrated equivalence, and `src/train.py --loss cosent` exists so
the next run can test it on a larger posting set rather than inherit the conclusion.

```bash
python scripts/significance.py --ablation
```

### 8. The explanation had never been measured (`scripts/eval_explanations.py`)

Every number above is about the score. Under every score the product also shows a
requirement-by-requirement skill gap, and until now it had no evaluation at all. It shipped
two constants, `COVERED_THRESHOLD = 0.50` and `PARTIAL_THRESHOLD = 0.35`, whose recorded
justification was a code comment saying they had been picked on the external test pairs.
Four cross-encoder fixes that did not work were ablated in detail; the thing a user actually
reads was not measured once.

What can be answered without new labels is whether the coverage number carries the signal it
implies. Whether an individual requirement was correctly called covered cannot: that needs a
human to read the requirement against the sentence cited for it, and grading it with the
model's own embeddings would be marking its own work.

Thresholds were swept on the 106-pair calibration half and reported on the untouched
106-pair final test, the same discipline the score calibrator follows.

| | Shipped (0.50 / 0.35) | Swept (0.65 / 0.55) |
|---|---|---|
| Spearman, coverage against match label | 0.6068 [+0.47, +0.72] | **0.6901** [+0.58, +0.78] |
| AUC, strong and good against weak and hard negative | 0.7961 [+0.70, +0.88] | **0.8478** [+0.77, +0.92] |

**The hand-picked constants were measurably wrong, and have been changed.** On data neither
pair was chosen on, retuning bought +0.0833 Spearman, 95% CI [+0.011, +0.161], and +0.0518
AUC, 95% CI [+0.006, +0.101]. Both intervals exclude zero. `app/explain.py` now ships
0.65 and 0.55, and a test fails if either constant moves without the evaluation being re-run.

The old values were too low for a reason worth stating: fine-tuning pushes related text well
above the cosine floor that any two English documents share, so 0.50 was marking as covered
a great deal that merely sat in the same domain as the requirement.

**Coverage does carry signal, and it holds up on the hard half.** Mean coverage runs 0.335
for strong pairs, 0.249 for good, 0.265 for partial, 0.082 for hard negatives and 0.037 for
weak. Hard negatives are the interesting number: they are keyword-dense and wrong-role, and
a coverage measure built on surface overlap would score them high. This one does not.

**The scope limit is the same one that binds the rest of the project.** This validates the
aggregate coverage measure. It does not validate a single requirement verdict, and no
statistic computed from these embeddings can.

### Comparison against a frontier LLM

Claude Opus 4.5 scored the same 106 held-out pairs through the production prompt, with
schema-constrained JSON, one call per pair, zero-shot:

| Engine | Spearman | MAE |
|---|---|---|
| **MPNet + Platt calibration (production)** | **0.8163** | **0.1270** |
| Claude Opus 4.5, calibrated (isotonic) | 0.7084 | 0.1613 |
| Claude Opus 4.5, raw | 0.7117 | 0.2518 |

Claude is a competent ranker but a poorly calibrated one: it compresses strong matches, and a
pair labelled 0.9 can score around 30 out of 100. Fitting the same calibrator on the
calibration half closes most of the absolute-error gap, from 0.25 to 0.16, but calibration is
monotonic and cannot change the ranking.

The ranking gap survives resampling: +0.105 Spearman, 95% CI [+0.020, +0.212], p = 0.012 under
a paired bootstrap over postings. That is a real difference, and the lower bound sitting close
to zero is part of the result. The defensible claim is that a 109M-parameter model fine-tuned
on 815 in-domain pairs outranks a frontier model *on this task and this test set*, not in
general.

The setup is a matched floor rather than Claude's ceiling: zero-shot, one call per pair, no
extended thinking (this Bedrock model rejects it), and no few-shot examples, while the
fine-tuned model saw 815 labelled pairs and Claude saw none. The question it answers is whether
task-specific fine-tuning earns its keep, not which model is stronger. Reproduce with
`scripts/claude_benchmark.py` and `scripts/calibrate.py`.

---

## A defect worth documenting

The first two production runs published a model that did not match its published metrics.

`SentenceTransformer.fit()` defaults to `save_best_model=True`, so `output_path` receives the
best checkpoint by *validation* score, while the in-memory model after training is the final
epoch. Notebook 05 calibrated and measured the in-memory model, then published the directory.
Different weights. The calibrator had been fitted to one model's cosine distribution and was
applied to another, so the published mean absolute error came out at 0.33 against a reported
0.12.

Nothing raised an error. The audit produced entirely plausible numbers about a model nobody
had evaluated.

Three guards now make this class of failure loud:

1. Notebook 05 reloads the saved checkpoint before calibrating, so the calibrator, the
   metrics, and the artifact are the same object.
2. Notebook 05's export cell re-downloads the published model and reports whether the
   publication actually happened.
3. Notebook 06 aborts if the published model's raw Spearman disagrees with
   `production_results.json` by more than 0.01, and `scripts/build_demo_data.py` refuses to
   bundle predictions that fail the same check.

`src/train.py` had the identical defect and has been fixed.

---

## Repository map

```
Notebooks/
  01 to 04            The study at 500 pairs from 150 postings, exploratory and unseeded
  05_production       The model that ships: 815 pairs, 3 seeds, CIs, publishes to the Hub
  06_model_audit      Bias audit, non-neural baselines, ablations. CPU only, no training
  07_loss_ablation    Does the combined loss beat its components. Pre-registered. It does not
Data/                 Training and external test CSVs
docs/DATA_CARD.md     Provenance, label schema, and the limits of what this data supports
Results/              Charts, per-pair predictions, and results_summary.json
models/               Calibrators. Model weights live on the HuggingFace Hub
src/                  text_utils, augment, train: the model pipeline
app/explain.py        Skill-gap analysis, shared by the scoring service
service/              FastAPI scoring service
web/                  Next.js demo page
scripts/              Claude benchmark, calibration, significance testing, explanation
                      evaluation, generation-artifact audit, behavioural probes, inference
                      benchmark, demo data pipeline, portfolio figures
docs/images/          Figures for the portfolio card, rendered from committed artifacts by
                      `scripts/make_portfolio_figures.py`
portfolio/            The case study as a Sanity document, for the public site
tests/, service/      Offline pytest suites
CITATION.cff          How to cite the study
ruff.toml             Python lint rules, enforced in CI alongside eslint
```

Notebooks 01 to 04 are exploratory: single training runs, unseeded, reporting an internal test
drawn from the same postings used for training. That was enough to find the calibration gap,
show the internal test set was misleading, and rule out four fixes. Notebook 05 is the
production run and is held to a different standard. The split is deliberate and stated in each
notebook.

## Dataset provenance

The job descriptions are real. The resumes and the match scores are not.

Job descriptions come from roughly 1,150 scraped LinkedIn postings, curated to 255 unique
training postings and 53 external ones across 14 industries and 4 seniority levels. Resume
text and match scores were synthetically generated and hand-curated against those real
postings, with five labelled match types: `strong`, `good`, `partial`, `hard_negative`, and
`weak`. Hard negatives are keyword-dense but wrong-role pairs, such as QA-automation Python
against backend Python, split into three subtypes.

The external test set (212 pairs, 53 postings, exactly 4 candidates each) has zero JD overlap
with training, asserted in code. It is deliberately harder than the training set: half of it
is hard negatives and weak matches, including career changers, overqualified candidates, and
keyword-stuffed mismatches.

Synthetic labels are the binding limitation. Every metric here measures fidelity to a labelling
rubric rather than to recruiter judgement, and no amount of methodological rigour changes that.
Full accounting in [`docs/DATA_CARD.md`](docs/DATA_CARD.md).

## Reproducing the model

The fine-tuned weights are not stored in this repository. Regenerate them:

```bash
pip install -r requirements.txt
python src/train.py
python src/train.py --push-to-hub USER/resume-jd-matcher-mpnet
```

On a free Colab T4 this takes roughly an hour. On CPU, plan for an overnight run.

`train.py` prints the final external-test table and writes `models/` (calibrators) plus
`Results/training_metrics.json`. It reloads the saved checkpoint before calibrating, so the
numbers it prints describe the weights it saved, and it records the Python, PyTorch, CUDA
and library versions it ran under, so a future run can tell an environment change apart from
the seed noise this study describes.

Dependencies are pinned rather than ranged, for the same reason. A study that attributes its
run-to-run spread to AMP non-determinism has to be able to show the software stack was held
constant.

Two flags switch on the changes this repository's own evidence points at, both off by
default so that a bare `python src/train.py` still reproduces the recipe behind the
published checkpoint:

```bash
python src/train.py --loss cosent                      # drop the CosineSimilarity term
python src/train.py --calibration-split posting-grouped # no posting in both halves
```

They are opt-in deliberately. A reproduction script that quietly produced a different model
from the published one would recreate the exact defect this repository documents below.

For the full multi-seed protocol with confidence intervals and precision@1, run
`Notebooks/05_production.ipynb` instead.

## Running the demo page

Two processes: the scoring service and the web app.

```bash
# 1. Scoring service
pip install -r service/requirements.txt
uvicorn service.main:app --reload --port 8000

# 2. Demo page
cd web
npm install
cp .env.example .env.local
npm run dev
```

The page reads `web/public/benchmark.json`, generated by `python scripts/build_demo_data.py`.
Without the scoring service configured, live scoring is disabled and the precomputed benchmark
still works, which is the part with evidence behind it.

| Variable | Purpose |
|---|---|
| `SCORING_SERVICE_URL` | The Python service. `http://localhost:8000` locally |
| `SCORING_SERVICE_SECRET` | Optional. Same value as the service's `PROXY_SECRET`, gives each visitor their own rate-limit budget |
| `ANTHROPIC_API_KEY` | Optional. Adds Claude to the live comparison |

### Deploying it

Two pieces, and the page is useful even if only the first ships. Everything the benchmark
section renders comes from `web/public/benchmark.json`, so the deployed page shows the full
held-out evidence with no scoring service behind it at all. Live scoring degrades to a
message rather than an error.

**1. The page, on Vercel.** Import the repository, set the root directory to `web`, and
deploy. Leave both environment variables unset for a first deploy: the benchmark explorer,
the significance table, the calibration scatter and the error profile all work without them.

**2. The scoring service, on Railway.** Create a Railway project from this GitHub repository.
[`railway.toml`](railway.toml) tells Railway to build the root `Dockerfile`, wait for `/health`
before switching traffic, and rebuild only when files the image contains change. The image
installs CPU-only PyTorch and bakes both the fine-tuned model and base MPNet in at build time,
so a container start loads weights from disk instead of downloading them. Generate a public
domain for the service, then set `SCORING_SERVICE_URL` on Vercel to it and redeploy. The full
walkthrough is in [`service/README.md`](service/README.md#deploy-to-railway).

If Railway's serverless sleeping is enabled, the first request after idle waits while the
420 MB model loads into memory. That cold start is the main argument for the efficiency study
in [`docs/EFFICIENCY_STUDY.md`](docs/EFFICIENCY_STUDY.md).

Before making the URL public, check three things. `RATE_LIMIT_REQUESTS` and
`RATE_LIMIT_WINDOW_SECONDS` default to 30 requests per minute per address. Every request the
web app makes arrives from Vercel, so visitors share one budget unless `PROXY_SECRET` on the
service and `SCORING_SERVICE_SECRET` on Vercel hold the same value. Adding `ANTHROPIC_API_KEY`
puts a paid engine behind a public endpoint. The service also caps input at 15,000 characters
independently of the web layer, because it is reachable without going through it.

Once deployed, set `demoUrl` in [`portfolio/resume-jd-matcher.md`](portfolio/resume-jd-matcher.md)
and add the link at the top of this file.

## Running the tests

```bash
pytest                # 226 tests: src/, app/, scripts/, and the scoring service
ruff check .          # lint, enforced in CI
cd web && npm test    #  68 tests: providers, benchmark maths, ATS keywords
cd web && npm run lint
```

Every one of these is offline. No test downloads a model, calls an API, or touches a network.
The sentence-transformer is replaced by a stub encoder with hand-chosen vectors, so assertions
about similarity bands, calibration, and JSON repair are exact rather than dependent on a live
model.

The tests that matter most guard invariants that would otherwise fail silently:

- **Published numbers still match their artifacts.** `tests/test_results_consistency.py`
  compares every figure in `results_summary.json` against the JSON the notebooks wrote. This
  exists because the summary had drifted twice, and a stale number is indistinguishable from a
  fresh one by inspection.
- **The statistics are checked against closed-form references**, not against another call of
  the same code. Wilson intervals are compared with published values, and the bootstrap is run
  on data whose answer is known by construction.
- **The portfolio card cannot outlive its own numbers.** It fed a public site while quoting a
  Spearman and a precision@1 from a run that predated the publication check. The expected
  strings are now derived from `production_results.json` rather than typed, so changing a
  metric without updating the card fails, and every figure it references must exist on disk.
- **Conclusions that rest on a null result get re-checked.** "The CosineSimilarity term can
  come out" holds only while CoSENT and the combined objective stay indistinguishable. If a
  re-run separates them, the test fails and the claim has to be rewritten rather than
  inherited.
- **Corrected claims cannot quietly revert to their uncorrected versions.** A test asserts
  that every headline engine comparison still survives Holm, and another asserts that the
  seed ensemble still does not. Both directions matter: the first stops an overstatement
  creeping back, the second stops a recommendation being upgraded without the evidence.
- **The explanation's thresholds cannot move without being re-measured.** They were
  hand-picked once and were measurably wrong. Changing either constant now fails a test
  unless `scripts/eval_explanations.py` has been re-run and agrees.
- The fine-tuned calibrator is never applied to base MPNet, where it would produce confident
  nonsense.
- Inputs receive the same 350-word preprocessing the model was trained under.
- One engine failing in comparison mode never blanks out the others.

## What I learned

- **External validation is not optional.** A held-out split from the same posting pool still
  flattered the cross-encoder by 1.5 Spearman points.
- **In low-data regimes, smaller and calibrated beats bigger and more expressive.** Every
  anti-overfitting technique helped the cross-encoder. None closed the gap.
- **Calibration is a product feature.** Users see the score, not the ranking. A model that
  reports 78% for a 16% match loses trust even when its ordering is correct.
- **Measure the artifact you ship, not the one in memory.** A default argument silently
  decoupled the published model from the published metrics, and only a cross-check between two
  notebooks caught it.
- **Two point estimates are not a comparison.** "0.82 against 0.71" says nothing on 106 pairs
  until it is resampled. Doing that properly also meant resampling postings rather than pairs,
  because four candidates drawn from one posting are not four independent observations.
- **Report the ablations that failed to test anything.** The preprocessing comparison produced
  two identical numbers, which is a result about the test set rather than about the method.
  Deleting it would have left a claim standing with nothing behind it.
- **Test the thing that shipped, not only the things that did not.** Four rejected
  cross-encoder fixes were ablated in detail while the combined loss went into production on
  an argument, and the skill-gap thresholds shipped on a code comment. Both were eventually
  measured. The loss turned out to be redundant and the thresholds turned out to be wrong.
  The decisions most likely to escape scrutiny are the ones that already appeared to work.
- **Correlation does not tell you what a model is reading.** 0.82 Spearman, resampled and
  corrected, sat comfortably on top of a model that rewards keyword stuffing on every single
  resume tested. Four interventions costing an afternoon found three weaknesses that a year of
  correlational evaluation would not have surfaced.
- **Check the harness before believing the finding.** The first behavioural run reported three
  failures and all three were mine, not the model's. The most alarming number in the batch
  (+0.39) came from a test that appended 200 words of job description to a 106-word resume. A
  suite that finds problems in a model is worth exactly what the care taken to rule out
  problems in the suite is worth.
- **Count the comparisons before believing any of them.** Ten bootstrap comparisons produced
  three that cleared 0.05, and this repository reported all three. Corrected within their
  families, one survives. Nothing was recomputed and no data changed; the arithmetic was
  always the same. The error was reading a table of p-values as a table of results.
- **"Not significant" is not a finding until you say what you could have detected.** The loss
  ablation's central null looked like evidence of equivalence and was a limit on the sample
  size. It can detect 0.045 Spearman and would need to rule out 0.017, so it was never
  capable of answering its own question, and only a power calculation showed that.
- **Pre-register the prediction, not just the experiment.** Writing down the expected
  mechanism before the runs is what turned a null result into an interpretable one: the
  arms moved exactly as predicted before calibration and converged exactly as predicted
  after it, so "no difference" meant redundancy rather than insufficient power.

### 9. Are the synthetic resumes copied from the postings? (`scripts/audit_generation_artifacts.py`)

The postings are real. The resumes were written against them. If the generator paraphrased a
posting to produce its strong-match resume, then part of what the model learned is that a good
pair shares phrasing rather than skills, and **external validation could not detect it**: the
training and external halves were produced the same way, so both would carry the artifact and
the transfer would look clean.

That would cap every number in this repository, so it is worth measuring rather than assuming.
The test is the length of shared spans, not the amount of overlap. Sharing skill vocabulary
produces short shared phrases; paraphrasing produces long ones. Each resume is compared against
its own posting and against a different posting from the same industry, which holds domain
vocabulary roughly constant.

| Shared n-grams | Own posting | Same-industry control | Excess | 95% CI |
|---|---|---|---|---|
| n = 2 | 0.0406 | 0.0401 | +0.0005 | [-0.0040, +0.0051] |
| n = 4 | 0.0028 | 0.0020 | +0.0008 | [-0.0006, +0.0022] |
| n = 6 | 0.0000 | 0.0000 | +0.0000 | [+0.0000, +0.0001] |
| n = 8 | 0.0000 | 0.0000 | +0.0000 | [+0.0000, +0.0000] |

**No copying detected, at any span length.** A resume shares no more with its own posting than
with an unrelated posting in the same industry, and long shared spans are absent entirely.

Two supporting checks agree. Terms appearing in exactly one posting across all 308 postings are
that posting's fingerprint, and only 8 of 212 resumes contain one of their own posting's unique
terms, with no elevation for strong pairs (0.057 mean for strong, 0.077 for partial, 0.038 for
hard negatives). And the model's agreement with the label survives removing overlap: 0.8164
uncontrolled, 0.8164 controlling for 6-gram overlap, 0.7845 controlling for 2-gram overlap,
against 0.3654 for lexical overlap alone.

**The limit of this result, stated because it is easy to overread.** It compares synthetic
pairs against synthetic pairs. It establishes that a resume was not paraphrased from its own
posting. It cannot establish that synthetic resumes as a class are not cleaner, more
keyword-dense, or more uniformly structured than real ones, which needs real resumes and is
Tier 2 of [`docs/VALIDATION_ROADMAP.md`](docs/VALIDATION_ROADMAP.md).

### 10. Does the score actually read coverage? (`scripts/behavioral_tests.py`)

Everything above is correlational. The model agrees with a label across 106 pairs, and that
agreement is resampled, corrected and bounded, but none of it shows the score *responds* to
requirement coverage. A model reading something else entirely would produce the same
correlation.

So: four interventions, each changing exactly one thing about a held-out resume and rescoring
it against the same posting. Directions were written down before running. Raw cosine, because
Platt is monotone and cannot change the sign of any effect here.

| Intervention | Expected | Mean change | 95% CI | |
|---|---|---|---|---|
| Remove the sentence the model itself cited as evidence | fall | **-0.0448** | [-0.056, -0.034] | pass |
| Add unevidenced tool names to a weak resume | no rise | **+0.0847** | [+0.072, +0.096] | **fail** |
| Reorder the sentences, changing no words | no change | **-0.0406** | [-0.052, -0.030] | **fail** |
| Append fluent, empty, senior-sounding filler | no rise | **+0.0202** | [+0.014, +0.027] | **fail** |

**One of four holds. The three failures are the useful part.**

**The score does respond to its own evidence.** Removing the sentence the model identified as
covering the top requirement costs 0.045. The explanation and the score are describing the
same thing, which is the one result the product's core claim depends on.

**Keyword stuffing works on this model, and the product's copy says it does not.** Appending
roughly 13 words of the posting's tool names to a weak or hard-negative resume, naming only
terms the resume does not already evidence, raises the score by 0.085. It rose for **all 52 of
52** resumes tested, so this is not an average over mixed outcomes. The product warns users
that adding unevidenced terms reproduces the pattern hard negatives were built from. On this
evidence that warning is wrong, and the honest version is that the model cannot tell an
evidenced skill from a claimed one.

In fairness to the model: its hard negatives were keyword-dense resumes *from the wrong role*,
which is a different attack from a plausible resume with a skills line bolted on. It was never
trained against this one. That explains the failure without excusing the copy.

**Sentence order moves the score by a third of its typical error.** Reordering sentences
without changing a word costs 0.041, measured against the same sentences rejoined in their
original order so that reformatting cancels out. Nothing about matching a resume to a posting
justifies that dependency; it is a property of mean-pooled embeddings over a document.

**Empty filler is rewarded.** Fluent, irrelevant, senior-sounding prose that names no skill
from the posting raises the score by 0.020.

These are the results correlational evaluation cannot produce, and the reason Tier 0 of the
[validation roadmap](docs/VALIDATION_ROADMAP.md) is worth doing before any of the expensive
tiers. Three of them are weaknesses in the shipped model that 0.82 Spearman conceals.

> **A note on the harness, because it nearly produced three false findings.** The first
> version of this suite reported keyword stuffing at +0.39 and sentence order at -0.042, and
> both were bugs. `keyword_stuff` appended whole requirement sentences, about 200 words against
> a median resume of 106, so it measured what happens when you paste a posting into a resume.
> `shuffle_sections` compared against the untouched resume rather than against the same text
> rejoined in its original order, so it charged reordering for the whitespace that splitting
> and rejoining destroys. Fixing the first cut the effect from 0.39 to 0.085; fixing the second
> moved it by 0.002, so that confound turned out to be small. A suite that finds problems in
> the model is worth exactly as much as the care taken to rule out problems in the suite, and
> `tests/test_tier0_audits.py` now pins both repairs.

## What this study answers, and what it does not

Worth stating directly, because the distinction is easy to lose behind a table of confidence
intervals.

**Answered:** can a small bi-encoder learn a resume-to-posting scoring rubric well enough to
rank candidates on job postings it has never seen, and does that beat word counting, the base
model, and a frontier LLM? Yes, measurably, and every gap is resampled and corrected.

**Not answered:** does the score predict job fit. The labels are synthetic, so what is
measured is fidelity to a rubric this project wrote. That is a real limitation of the
evidence, not a caveat about precision, and it is not repaired by better statistics.

The two are worth separating further, because "job fit" is itself four different targets.
Actual job performance is unmeasurable here and largely unmeasurable anywhere: it is observed
only for people who were hired, which is selection bias by construction. Screening outcomes
are obtainable in principle but encode the behaviour of the process that produced them, so a
model that predicted them well would be reproducing recruiter decisions, including their
failures. The reachable target is expert judgment, and even that licenses only "agrees with
recruiters on this distribution".

The path there is costed and sequenced in
[`docs/VALIDATION_ROADMAP.md`](docs/VALIDATION_ROADMAP.md). Its central point is that real
labels are needed for validation rather than training, which puts the decisive experiment at
roughly 300 pairwise expert comparisons rather than thousands of labelled rows. Its second
point is that the headline of that experiment should be the inter-rater agreement ceiling,
because a model cannot meaningfully be said to beat or miss a target that professionals do not
agree on either.

Two checks in that roadmap need no new data at all and bound how much the rest is worth: a
test for generation artifacts in the synthetic resumes, and skill-perturbation tests that
establish the score responds to requirement coverage causally rather than correlationally.

## Limitations and next steps

Ordered by how much they constrain the conclusions.

- **Synthetic match labels.** Every metric measures fidelity to a labelling rubric rather than
  to recruiter judgement. This study answers "can a model learn a labelling function" and does
  not answer "can a model predict job fit". No amount of methodological rigour substitutes for
  fixing it, because the gap is in the labels rather than in the analysis.
  [`docs/VALIDATION_ROADMAP.md`](docs/VALIDATION_ROADMAP.md) is the plan for closing it,
  ordered by value per unit of effort, and the short version is that real labels are needed
  for **validation, not training**: a few hundred expert pairwise comparisons, not a few
  thousand training rows.
- **The model cannot distinguish an evidenced skill from a claimed one.** Adding unevidenced
  tool names to a weak resume raises its score by 0.085, on all 52 resumes tested. Any product
  built on this must not tell users that keyword stuffing is caught, and should treat a bare
  skills list as weaker evidence than a sentence that demonstrates the skill. Fixing it in the
  model needs training negatives of this specific shape, which the current data does not have.
- **The score depends on sentence order** by 0.041, about a third of its typical error, with
  words unchanged. A property of mean-pooled document embeddings, not of the task.
- **Fluent empty filler raises the score** by 0.020, so length and register are rewarded
  slightly over content.
- **The score compresses toward the middle.** Strong matches are underscored by 0.166 on
  average and weak ones overscored by 0.091. The ordering is trustworthy; the absolute number
  is not a percentage fit. Fixing this needs either a loss that penalises the compression
  directly or a calibrator with more freedom at the ends than 106 pairs can safely support.
- **The calibration split is not posting-disjoint.** The 212 external pairs were split
  stratified by match type, so 47 of the 50 final-test postings also contributed candidates to
  the calibration half. Ranking metrics cannot be affected, because calibration is monotonic,
  and the measured effect on MAE is 0.0006 under leave-one-posting-out refitting. A
  posting-grouped split is still the cleaner design and is the first change for any re-run.
  It is now implemented behind `--calibration-split posting-grouped` rather than only
  described, but the published checkpoint predates it.
- **106 final-test pairs produce wide intervals.** Differences smaller than the interval width
  are not meaningful, which is why `Results/significance.json` exists rather than a table of
  point estimates.
- **The run is not bit-reproducible, and the published interval understates that.** Three runs
  of one recipe span 0.8273 to 0.8447 in aggregate Spearman. See
  [Reproducibility](#the-run-is-not-bit-reproducible). Dropping AMP would fix it at roughly
  twice the training cost.
- **The preprocessing ablation is uninformative** on this test set, since no posting in it is
  long enough to truncate. See notebook 06.
- **The loss ablation is underpowered for the question it asked.** Its central comparison
  can detect 0.0452 Spearman at 80% power and would need to rule out 0.0174 to establish
  equivalence, so "CoSENT alone is indistinguishable from the combined loss" is a failure to
  detect rather than a demonstrated tie. Settling it needs roughly 338 postings against the
  50 available, or 164 for the MAE version of the same question. This is the clearest case
  in the project of a conclusion that needed more data rather than better analysis.
- **The 3-seed CoSENT ensemble reached 0.8639 against the shipped 0.8163** and was
  previously described here as the one upgrade the evidence supported, at p 0.021. Corrected
  within its exploratory family it sits at 0.079 and does not survive. It also triples
  serving cost. Both the statistical and the serving question are open.
- **The explanation is validated in aggregate only.** Coverage correlates with the match
  label at 0.6901 and separates good pairs from bad at 0.8478 AUC, on held-out postings.
  Whether any individual requirement was correctly called covered, and whether the sentence
  cited as evidence supports it, is untested and needs human labels.
- **Per-arm precision@1 has not been measured on the full external set.** The ablation
  exported only the 106-pair final test, which averages two candidates per posting and so is
  a much easier ranking task than the 53-posting, four-candidate setup the headline 84.9%
  comes from. The arms should not be compared on precision@1 until that is recomputed.
- E5 outperformed MPNet in one run of notebook 02 and was not carried forward. It deserves a
  multi-seed re-test.
- ONNX or quantized export for cheaper CPU serving.
- **The demo page is not deployed.** Everything needed to run it is here and nothing is
  clickable, which for a study meant to be read is a real gap.

---

*David Lepighe, April to August 2026. [github.com/dlepighe1](https://github.com/dlepighe1)*
