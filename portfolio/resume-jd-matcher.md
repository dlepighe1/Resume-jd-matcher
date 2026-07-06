---
title: "ResumeAI — Resume ↔ Job Description Matcher"
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
  - Streamlit
timeline: Apr 2026 – Jul 2026
role: Solo — ML Engineer
image: resume-jd-matcher-cover.jpg   # 2000×1125, hotspot on the score + skill-gap panel
description: >-
  A fine-tuned sentence-transformer system that scores how well a resume fits a job
  description on a calibrated 0–100% scale and explains the verdict with a
  requirement-by-requirement skill-gap analysis.
longDescription: >-
  ResumeAI fine-tunes MPNet embeddings on 815 curated resume–JD pairs built from 305 real
  LinkedIn job postings, then calibrates the scores so "82% match" actually means 82%.
  The project is structured as a five-notebook research study: baseline fine-tuning,
  an architecture comparison (bi-encoder vs cross-encoder vs hybrid), an external
  validation round that exposed catastrophic cross-encoder overfitting (0.89 Spearman
  internal → −0.61 external), a systematic ablation of four overfitting fixes, and a
  production rebuild that let the evidence pick the architecture. A Streamlit app serves
  the final model with deterministic skill-gap explanations.

# --- AI/ML fields ---
problem: >-
  Keyword-based resume screening scores a "QA engineer who writes Python test scripts"
  highly against a "Python backend developer" posting — same keywords, wrong role. And
  ML matchers that only optimize ranking show users inflated scores (everything lands
  between 50–90%), so the numbers can't be trusted for real decisions.
goal: >-
  Build a matcher that (1) ranks candidate–job fit above 0.85 Spearman on job postings it
  has never seen, (2) produces calibrated absolute scores (MAE ≤ 0.12) rather than
  compressed cosine similarities, and (3) explains every verdict.
outcome: >-
  Final model reaches 0.867 Spearman and 0.100 MAE on a 106-pair external test drawn from
  53 completely unseen job postings, with 13 of 14 industries under 0.15 MAE — and the
  study documents why the "stronger" cross-encoder architecture had to be rejected.

datasetSource: >-
  ~1,150 scraped LinkedIn job postings curated to 305 unique JDs across 14 industries;
  resume texts and match scores synthetically generated and hand-curated against them.
datasetSize: "1,027 labeled pairs (815 training from 305 JDs + 212 external test from 53 unseen JDs)"
datasetClasses: "5 match types (strong, good, partial, hard_negative, weak)"
datasetPreprocessing: >-
  Smart JD truncation (strip EEO/benefits/salary boilerplate, prioritize requirements
  sections), 3× data augmentation (resume section shuffling, sentence dropping, keyword
  noise, ±0.02 score jitter), stratified splits by match type (seed 42).

modelUsed: "Fine-tuned all-mpnet-base-v2 (109M params) + isotonic calibration"
modelApproach: >-
  Bi-encoder trained with a combined objective — CoSENTLoss for ranking plus
  CosineSimilarityLoss for absolute-score signal — then post-hoc isotonic calibration
  fitted on a 106-pair external calibration split so score mapping generalizes to unseen JDs.
modelTraining: "4 epochs, batch 16, 10% warmup, AMP mixed precision on a Colab T4 (~1 h)"
modelEvaluation: >-
  Spearman (ranking) + MAE (calibration) on a stratified 106-pair external final test with
  zero JD overlap with training or calibration; error broken down per match type and per
  industry. Internal-only evaluation was explicitly rejected after it inflated a
  cross-encoder by 1.5 Spearman points.

pipelineSteps:
  - "Ingest resume & JD text"
  - "Smart truncation & cleanup"
  - "Augment training pairs"
  - "Fine-tune MPNet (combined loss)"
  - "Calibrate scores (isotonic)"
  - "Score & explain fit"

resultsMetrics:
  - { label: "Spearman (unseen JDs)", value: 0.87 }
  - { label: "MAE", value: 0.10 }
  - { label: "Industries < 0.15 MAE", textValue: "13/14" }
  - { label: "Batch ranking", textValue: "106 resumes / 1.1 s" }

confusionMatrix: ""   # n/a — regression task; scatter plots used instead
trainingCurve: 05_production_v2_fig1.png   # 1600×900 — external-test comparison chart

challengesSolutions:
  - challenge: "The best internal model (RoBERTa cross-encoder, 0.89 Spearman) collapsed to −0.61 Spearman on job postings outside the training pool — it had memorized 200 JDs (312k parameters per training example)."
    solution: "Built a 212-pair external test set from 53 unseen postings, made it the only reported metric, and ablated four fixes (3× augmentation, weight decay, smaller DistilRoBERTa, 5-fold ensemble). None beat the calibrated bi-encoder, so the evidence — not the leaderboard — picked the architecture."
  - challenge: "CoSENT-trained bi-encoders compressed every score into 0.5–0.9, so a 16% match displayed as '78% match'."
    solution: "Trained with a combined CoSENT + cosine-similarity objective and added isotonic calibration fitted on external data, cutting MAE from 0.23 to 0.10 while preserving ranking."
  - challenge: "83% of JDs exceeded the 512-token context window, and the requirements section — the highest-signal content — sits at the end and got truncated away."
    solution: "Wrote a preprocessing step that strips boilerplate (EEO, benefits, salary) and re-prioritizes requirements/qualifications sections into the context window."

keyInsights:
  - "External validation is non-negotiable — an internal split from the same JD pool flattered the cross-encoder by 1.5 Spearman points"
  - "In low-data regimes, smaller + calibrated beats bigger + expressive; every anti-overfitting trick helped, none closed the gap"
  - "Calibration is a product feature: users see the score, not the ranking"

impact:
  - { label: "Score latency", textValue: "~10 ms/pair (GPU)" }
  - { label: "External test coverage", textValue: "14 industries" }
  - { label: "Ranking throughput", textValue: "~100 resumes/s" }

whatILearned: >-
  This project taught me that model evaluation design matters more than model choice. I
  started out chasing the architecture with the best internal number and ended up shipping
  the "weaker" one because it was the only one that survived contact with unseen data.
  Building the external test set, breaking errors down by match type and industry, and
  treating calibration as a first-class metric changed every downstream decision — including
  scrapping a week of cross-encoder work when the ablation said so.

nextSteps:
  - "Collect recruiter-labeled pairs for a gold-standard test set (replace synthetic labels)"
  - "PDF resume parsing in the demo app"
  - "Score confidence intervals from ensemble fold-spread"
  - "ONNX / quantized export for CPU-cheap serving"

# Optional: set demoUrl + gallery[] to show the "Live Demo Showcase" grid.
demoUrl: ""   # TODO: HuggingFace Space URL after model upload (e.g. https://huggingface.co/spaces/dlepighe1/resume-jd-matcher)
gallery:
  - 03_final_study_external_eval_fig1.png
  - 04_overfitting_fixes_fig1.png
  - 05_production_v2_fig1.png
githubUrl: https://github.com/dlepighe1/Resume-jd-matcher
---

ResumeAI is a five-notebook research study turned product: fine-tuned MPNet embeddings that
score resume–job fit on a calibrated 0–100% scale, validated exclusively on job postings the
model never trained on, and served through a Streamlit app that explains every verdict with
a requirement-by-requirement skill-gap analysis.

The headline result — **0.867 Spearman / 0.100 MAE on 106 fully held-out external pairs** —
matters less than how it was reached: the study caught its own best internal model
catastrophically overfitting (0.89 → −0.61 Spearman), ablated four fixes, proved none of
them beat a simpler calibrated bi-encoder, and rebuilt the production system around that
evidence with 62% more unique job postings and a combined ranking + calibration loss.
