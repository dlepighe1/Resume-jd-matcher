# ResumeAI: Resume and Job Description Matching

A fine-tuned sentence-transformer that scores how well a resume fits a job description on a
calibrated 0 to 1 scale, explains which requirements are covered, and generalizes to job
postings it has never seen.

This is a research repository. It contains the study, the data, the trained model pipeline,
and a single demo page for inspecting the results. It is not a product.

**Current model:** `all-mpnet-base-v2` fine-tuned with a combined ranking and calibration
objective, plus Platt score calibration. Measured across three seeds on 106 fully held-out
pairs from 53 unseen job postings:

| Metric | Value |
|---|---|
| Spearman correlation | **0.8355 ± 0.0144** |
| Mean absolute error | **0.1145 ± 0.0071** |
| Production seed (43) | 0.834 Spearman, 95% CI [0.764, 0.876] |
| Base model before fine-tuning | 0.6246, so fine-tuning contributes **+0.211 Spearman** |
| Precision@1 across 53 unseen postings | **94.3%** against a 25% random baseline |

> **Status note.** These numbers describe `models/seed43`, the checkpoint saved by the most
> recent production run. That checkpoint has not yet been published to the HuggingFace Hub,
> so the live demo cannot serve it and the audit notebook has not been re-run against it.
> See [Reproducing the model](#reproducing-the-model).

| | |
|---|---|
| Full metrics | [`Results/results_summary.json`](Results/results_summary.json) |
| Research notebooks | [`Notebooks/`](Notebooks/), 01 to 05 in story order, plus an audit |
| Data card | [`docs/DATA_CARD.md`](docs/DATA_CARD.md) |
| Scope of this repo | [`docs/RESEARCH_SPEC.md`](docs/RESEARCH_SPEC.md) |
| Product spec (separate repo) | [`docs/SAAS_SPEC.md`](docs/SAAS_SPEC.md) |
| Reproduce | `python src/train.py` |
| Tests | 80, all offline: no model downloads, no API calls |

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
- **Combined loss.** CoSENT for ranking plus CosineSimilarity for absolute score, so the
  model receives gradient signal in both directions.
- **Calibration fitted on external data.** The 212 external pairs split 106 for calibration
  and 106 for the final test. Every reported number comes from the untouched half.
- **Production discipline.** Every RNG seeded before each `fit()` call, three seeds reported
  as mean and standard deviation, a base-model baseline on the same held-out pairs, bootstrap
  95% confidence intervals, and precision@1 across the unseen postings.

Results on the 106-pair final test:

| Model | Spearman | MAE |
|---|---|---|
| **MPNet + Platt calibration (production)** | **0.834** | **0.1163** |
| MPNet + isotonic calibration | 0.8343 | 0.1077 |
| MPNet raw (combined loss) | 0.834 | 0.1561 |
| DistilRoBERTa cross-encoder (augmented, regularized) | 0.7586 | 0.1939 |
| Base MPNet, no fine-tuning | 0.6246 | 0.2138 |

The two calibrators are statistically tied. A 2,000-resample bootstrap on the difference in
mean absolute error gives a 95% interval of [-0.0005, +0.0177], which straddles zero. Platt
ships on a robustness argument rather than a metric win: a two-parameter sigmoid cannot
overfit a 106-pair calibration split, while an isotonic step function can.

Across three seeds the model spans 0.8186 to 0.8538 Spearman. That spread is a property of
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

It runs on CPU in about 15 minutes.

The audit currently reports results for the model on the HuggingFace Hub, which is an older
checkpoint than `models/seed43`. Its model-dependent findings are quarantined in
`results_summary.json` until the current model is published and the audit is re-run. Its
baselines (TF-IDF 0.5657, word overlap 0.5592, base MPNet 0.6246) do not depend on the
published model and are valid.

### Comparison against a frontier LLM

Claude Opus 4.5 scored the same 106 held-out pairs through the production prompt, with
schema-constrained JSON, one call per pair, zero-shot:

| Engine | Spearman | MAE |
|---|---|---|
| **MPNet + Platt calibration (production)** | **0.834** | **0.1163** |
| Claude Opus 4.5, calibrated (isotonic) | 0.7084 | 0.1613 |
| Claude Opus 4.5, raw | 0.7117 | 0.2518 |

Claude is a competent ranker but a poorly calibrated one: it compresses strong matches, and a
pair labelled 0.9 can score around 30 out of 100. Fitting the same calibrator on the
calibration half closes most of the absolute-error gap, from 0.25 to 0.16, but calibration is
monotonic and cannot change the ranking. The purpose-built model leads on both.

This was a matched single-call setup with no extended thinking, so it represents a floor for
Claude rather than its ceiling. Reproduce with `scripts/claude_benchmark.py` and
`scripts/calibrate.py`.

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
Data/                 Training and external test CSVs
docs/DATA_CARD.md     Provenance, label schema, and the limits of what this data supports
Results/              Charts, per-pair predictions, and results_summary.json
models/               Calibrators. Model weights live on the HuggingFace Hub
src/                  text_utils, augment, train: the model pipeline
app/explain.py        Skill-gap analysis, shared by the scoring service
service/              FastAPI scoring service
web/                  Next.js demo page
scripts/              Claude benchmark, calibration, demo data pipeline
tests/, service/      Offline pytest suites
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
numbers it prints describe the weights it saved.

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
| `ANTHROPIC_API_KEY` | Optional. Adds Claude to the live comparison |

## Running the tests

```bash
pytest                # 61 tests: src/, app/, and the scoring service
cd web && npm test    # 19 tests: providers, benchmark maths, ATS keywords
```

Every one of these is offline. No test downloads a model, calls an API, or touches a network.
The sentence-transformer is replaced by a stub encoder with hand-chosen vectors, so assertions
about similarity bands, calibration, and JSON repair are exact rather than dependent on a live
model.

The tests that matter most guard invariants that would otherwise fail silently:

- the fine-tuned calibrator is never applied to base MPNet, where it would produce confident
  nonsense
- inputs receive the same 350-word preprocessing the model was trained under
- one engine failing in comparison mode never blanks out the others

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

## Limitations and next steps

- Synthetic match labels. Collecting recruiter-labelled pairs for a gold test set is the
  highest-value addition to this project.
- 106 final-test pairs produce wide confidence intervals. Differences smaller than the interval
  width are not meaningful.
- E5 outperformed MPNet in one run of notebook 02 and was not carried forward. It deserves a
  multi-seed re-test.
- ONNX or quantized export for cheaper CPU serving.

---

*David Lepighe, April to July 2026. [github.com/dlepighe1](https://github.com/dlepighe1)*
