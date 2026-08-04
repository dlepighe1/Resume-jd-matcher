---
title: "ResumeAI. Resume ↔ Job Description Matcher"
slug: resume-jd-matcher
projectType: ai_ml_case_study
category: AI Innovations
status: completed
tags:
  - Python
  - PyTorch
  - Sentence-Transformers
  - HuggingFace
  - scikit-learn
  - FastAPI
  - Next.js
timeline: Apr 2026 to Aug 2026
role: Solo. ML Engineer
image: resume-jd-matcher-cover.jpg   # 2000×1125, hotspot on the score + skill-gap panel
description: >-
  A fine-tuned sentence-transformer that scores how well a resume fits a job description on a
  calibrated 0 to 1 scale, explains which requirements are missing, and is validated only on
  job postings it has never seen.
longDescription: >-
  ResumeAI fine-tunes MPNet embeddings on 815 curated resume and job-description pairs built
  from 255 real LinkedIn postings, then calibrates the scores so the number means something.
  It is structured as a seven-notebook research study: baseline fine-tuning, an architecture
  comparison, an external validation round that exposed catastrophic cross-encoder
  overfitting (0.8917 Spearman internal against -0.6122 external), a systematic ablation of
  four overfitting fixes that all failed, a production rebuild that let the evidence pick the
  architecture, a bias and baseline audit of the shipped model, and a pre-registered loss
  ablation that removed half the production objective. Every reported difference is tested
  with a paired cluster bootstrap rather than asserted from two point estimates.

# --- AI/ML fields ---
problem: >-
  Keyword-based resume screening scores a "QA engineer who writes Python test scripts" highly
  against a "Python backend developer" posting: same keywords, wrong role. And ML matchers
  that only optimize ranking show inflated scores, with everything landing between 0.5 and
  0.9, so the number cannot be trusted even when the ordering is right.
goal: >-
  Build a matcher that (1) ranks candidate and job fit on postings it has never seen,
  (2) produces calibrated absolute scores rather than compressed cosine similarities,
  (3) explains every verdict, and (4) proves each of those claims survives resampling.
outcome: >-
  The model picks the best of four candidates first for 84.9% of 53 unseen postings (45/53,
  Wilson 95% CI [73%, 92%]) against a 25% random baseline, at 0.8273 +/- 0.0236 Spearman and
  0.1194 +/- 0.0113 MAE across three seeds on a 106-pair fully held-out test. A paired
  cluster bootstrap over postings separates it from base MPNet (+0.192, p < 0.001), from
  TF-IDF (+0.251), from word overlap (+0.257), and from Claude Opus 4.5 (+0.105, p = 0.012)
  at 109M parameters. The study is equally a record of what did not work: a rejected
  cross-encoder, four failed fixes, an ablation that measured nothing, and a shipped design
  choice that a pre-registered test later removed.

datasetSource: >-
  ~1,150 scraped LinkedIn job postings curated to 255 unique training postings plus 53 held
  out, across 14 industries and 4 seniority levels. Resume texts and match scores are
  synthetically generated and hand-curated against those real postings.
datasetSize: "1,027 labeled pairs (815 training from 255 postings + 212 external test from 53 unseen postings)"
datasetClasses: "5 match types (strong, good, partial, hard_negative, weak)"
datasetPreprocessing: >-
  Smart JD truncation (strip EEO, benefits and salary boilerplate, prioritize requirements
  sections, 350-word cut), 3× data augmentation (resume section shuffling, sentence dropping,
  keyword noise, ±0.02 score jitter), stratified splits by match type (seed 42).

modelUsed: "Fine-tuned all-mpnet-base-v2 (109M params) + Platt calibration"
modelApproach: >-
  Bi-encoder trained with a combined objective, CoSENTLoss for ranking plus
  CosineSimilarityLoss for absolute score, then post-hoc Platt calibration fitted on a
  separate 106-pair external calibration split so the score mapping generalizes to unseen
  postings. Platt ships over isotonic on a robustness argument rather than a metric win: the
  two are statistically tied, and a 2-parameter sigmoid cannot overfit a 106-pair split while
  an isotonic step function can. A later pre-registered ablation found the CosineSimilarity
  half of the objective contributes nothing measurable once calibration is applied.
modelTraining: "4 epochs, batch 16, 10% warmup, AMP mixed precision, 3 seeds, ~24 min/seed on a Colab T4"
modelEvaluation: >-
  Spearman for ranking and MAE for calibration on a stratified 106-pair external final test
  with zero posting overlap with training, asserted in code rather than assumed. Reported as
  means across three seeds with bootstrap confidence intervals, plus precision@1 over 53
  unseen postings, a base-model baseline on the identical pairs, non-neural baselines, a
  reliability diagram, and a demographic name-substitution audit. Internal-only evaluation
  was explicitly rejected after it inflated a cross-encoder by 1.5 Spearman points.

pipelineSteps:
  - "Ingest resume & JD text"
  - "Smart truncation & cleanup"
  - "Augment training pairs"
  - "Fine-tune MPNet (combined loss)"
  - "Calibrate scores (Platt)"
  - "Score & explain fit"

resultsMetrics:
  - { label: "Precision@1 (53 unseen postings)", textValue: "84.9% vs 25% random" }
  - { label: "Spearman (unseen postings)", value: 0.827 }
  - { label: "MAE (Platt calibrated)", value: 0.119 }
  - { label: "Gain over frontier LLM", textValue: "+0.105 Spearman, p = 0.012" }

confusionMatrix: ""   # n/a, regression task; scatter and reliability plots used instead
trainingCurve: production_model_comparison_2026-07-07.png   # external-test comparison chart

challengesSolutions:
  - challenge: "The best internal model, a RoBERTa cross-encoder at 0.8917 Spearman, collapsed to -0.6122 on postings outside the training pool. Not merely worse, but anti-correlated: it ranked good candidates below bad ones. It had memorized the 150 training postings, at roughly 312k parameters per training example."
    solution: "Built a 212-pair external test set from 53 unseen postings with zero overlap asserted in code, made it the only reported metric, and ablated four fixes: 3× augmentation, weight decay, a smaller DistilRoBERTa backbone, and a 5-fold ensemble. Every fix helped, moving external Spearman from -0.35 to +0.51. None beat the simpler calibrated bi-encoder at 0.77, so the evidence rather than the leaderboard picked the architecture."
  - challenge: "CoSENT-trained bi-encoders compress every score into roughly 0.5 to 0.9, because any two English documents share a cosine similarity floor. A 16% match displayed as 78%."
    solution: "Added post-hoc calibration fitted on a held-out external split, cutting MAE from 0.180 to 0.127 on the production seed while leaving the ranking untouched, since a strictly increasing map cannot change ranks. The residual compression is quantified rather than hidden: strong matches are still underscored by 0.166, so the output is documented as a ranking signal rather than a percentage fit."
  - challenge: "The one production design choice that was reasoning rather than evidence was the combined CoSENT plus CosineSimilarity objective. Four rejected cross-encoder fixes had been ablated in detail; the thing that actually shipped had not."
    solution: "Pre-registered a three-arm, three-seed ablation with the hypothesis and predicted mechanism committed before any run, and matched gradient-step counts across arms by giving every arm two dataloaders so the loss could not be confounded with a longer schedule. All three predictions held and H1 was supported: after calibration, CoSENT alone is indistinguishable from the combined objective (+0.0024 Spearman, p = 0.89), so half the loss function comes out."
  - challenge: "Two production runs published a model that did not match its published metrics. SentenceTransformer.fit() defaults to save_best_model=True, so output_path receives the best-by-validation checkpoint while the in-memory model is the final epoch. The calibrator had been fitted to one model and applied to another, and nothing raised an error."
    solution: "Reloaded the saved checkpoint before calibrating so the calibrator, the metrics and the artifact are the same object, then added three guards that fail loudly: the training notebook re-downloads and verifies its own publication, the audit notebook aborts on a mismatch above 0.01 Spearman, and the demo pipeline refuses to bundle predictions that fail the same check."

keyInsights:
  - "External validation is not optional. A held-out split from the same posting pool still flattered the cross-encoder by 1.5 Spearman points"
  - "In low-data regimes, smaller and calibrated beats bigger and more expressive. Every anti-overfitting technique helped the cross-encoder; none closed the gap"
  - "Calibration is a product feature. Users see the score, not the ranking"
  - "Measure the artifact you ship, not the one in memory. A default argument silently decoupled the published model from the published metrics"
  - "Two point estimates are not a comparison. Resampling has to happen at the posting level, because four candidates from one posting are not four independent observations"
  - "Test the thing that shipped, not only the things that did not. The decisions most likely to escape scrutiny are the ones that already worked"

impact:
  - { label: "Held-out validation", textValue: "53 postings, zero overlap" }
  - { label: "Differences tested", textValue: "paired bootstrap, 10k resamples" }
  - { label: "Test suite", textValue: "170 tests, fully offline" }

whatILearned: >-
  This project taught me that evaluation design matters more than model choice. I started out
  chasing the architecture with the best internal number and shipped the "weaker" one because
  it was the only one that survived contact with unseen data. The harder lesson came later:
  the parts of a system most likely to go unexamined are the parts that already appear to
  work. I had ablated four cross-encoder fixes that failed while the loss function actually
  running in production rested on an argument I had never tested. When I finally pre-registered
  a test for it, the argument did not hold and half the objective came out. Building the
  external test set, resampling at the posting level, auditing the shipped model for name
  sensitivity, and writing guards that fail loudly rather than trusting my own vigilance
  changed every downstream decision in the project.

nextSteps:
  - "Collect recruiter-labeled pairs for a gold-standard test set, replacing synthetic labels"
  - "Posting-grouped calibration split, the cleaner design for any re-run"
  - "Drop the CosineSimilarity objective, which the ablation showed is redundant"
  - "Resolve the 3-seed ensemble trade-off: +0.0257 Spearman against 3x serving cost"
  - "ONNX or quantized export for cheaper CPU serving"

# Optional: set demoUrl + gallery[] to show the "Live Demo Showcase" grid.
demoUrl: ""   # TODO: Vercel URL once web/ is redeployed against the current research demo page
gallery:
  - 03_external_validation_fig1.png
  - 04_overfitting_fixes_fig1.png
  - production_model_comparison_2026-07-07.png
  - model_audit.png
githubUrl: https://github.com/dlepighe1/Resume-jd-matcher
---

ResumeAI is a seven-notebook research study: fine-tuned MPNet embeddings that score resume
and job-description fit on a calibrated 0 to 1 scale, validated exclusively on job postings
the model never trained on, with a requirement-by-requirement skill-gap analysis and a demo
page for inspecting the held-out benchmark pair by pair.

The headline result is that the model picks the right candidate first for **84.9% of 53
unseen postings** where guessing gets 25%, and that it **outranks Claude Opus 4.5** on the
same held-out pairs by +0.105 Spearman (95% CI [+0.020, +0.212], p = 0.012) at 109M
parameters. But the number matters less than how it was reached.

The study caught its own best internal model catastrophically overfitting, at 0.8917 Spearman
internal against -0.6122 external, ablated four fixes, proved none of them beat a simpler
calibrated bi-encoder, and rebuilt the production system around that evidence with 70% more
unique job postings.

It also caught a defect in its own release process. `SentenceTransformer.fit()` saves the
best-by-validation checkpoint while leaving the final epoch in memory, so an early production
run published a model whose calibrator had been fitted to different weights. An automated
cross-check between the training notebook and the audit notebook found it, and three guards
now make that class of failure impossible to miss.

The last notebook turned the same scrutiny on a decision that had already shipped. The
production model trained with a combined CoSENT and CosineSimilarity objective, justified by
an argument rather than an experiment. A pre-registered three-arm ablation, with the
hypothesis and the predicted mechanism committed before any run, found that after calibration
the CosineSimilarity term contributes nothing measurable. Half the loss function comes out.
Every prediction registered in advance held, which is what separates a redundant component
from an underpowered test.
