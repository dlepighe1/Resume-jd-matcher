# ResumeAI — Resume ↔ Job Description Matching

Fine-tuned sentence-transformer system that scores how well a resume fits a job description
(0–1, calibrated), explains *why* via skill-gap analysis, and generalizes to job postings it
has never seen.

**Final model:** `all-mpnet-base-v2` fine-tuned with a combined ranking + calibration loss,
plus Platt score calibration — **Spearman 0.86, MAE 0.10 on 106 fully held-out pairs
from unseen job postings**, with 13 of 14 industries under 0.15 MAE. Platt is the
production calibrator (a 2-parameter sigmoid can't overfit a 106-pair calibration set);
isotonic regression scores identically within bootstrap noise.

| | |
|---|---|
| 🎯 Live demo | *(HuggingFace Space — link coming after model upload)* |
| 📊 Full metrics | [`Results/results_summary.json`](Results/results_summary.json) |
| 📓 Research notebooks | [`Notebooks/`](Notebooks/) — five notebooks, in story order |
| 🔁 Reproduce | `python src/train.py` (details below) |

---

## The story (why this project is interesting)

This isn't a "fine-tuned a model, got a number" project. The interesting part is what went
wrong in the middle and how the evidence changed the design.

### 1. Baseline fine-tuning (`Notebooks/01`)
Fine-tuned three bi-encoders (MiniLM, MPNet, BGE) on 500 curated resume–JD pairs with
CoSENTLoss. Stratified 80/10/10 splits, baselines measured before training, per-match-type
error analysis. Fine-tuning roughly doubled ranking quality over the base models.

### 2. Architecture study (`Notebooks/02`)
Compared classic bi-encoder (MPNet), instruction-aware bi-encoder (E5), a RoBERTa
cross-encoder, and a two-stage hybrid. Found the **calibration gap**: CoSENT-trained
bi-encoders rank well but compress every score into ~0.5–0.9 (cosine floor). Isotonic
regression fixed most of it without retraining.

### 3. External validation exposes the fraud (`Notebooks/03`)
Built a 212-pair external test set from 53 job postings the models had *never seen*, plus
smart JD preprocessing (strip EEO/benefits boilerplate, prioritize requirements sections).
Result: the cross-encoder that looked like the winner — **0.89 Spearman internally —
collapsed to −0.61 Spearman externally.** It had memorized the 200 training JDs
(125M parameters ÷ 400 training pairs ≈ 312k parameters per example). The humble
bi-encoder + calibration held up at 0.76 external. **Internal test sets lie; external
validation is the only number that matters.**

### 4. Systematic fixes — and an honest negative result (`Notebooks/04`)
Ablated four overfitting fixes on the cross-encoder: 3× data augmentation (section
shuffling, sentence dropping, keyword noise), weight decay, a smaller DistilRoBERTa, and a
5-fold ensemble. Every fix helped (−0.35 → +0.51 external Spearman) — **and none of them
beat the simple calibrated bi-encoder (0.77).** At this data scale, architecture capacity
is a liability, not an asset.

### 5. Production v2 (`Notebooks/05`) → Production v3 (`Notebooks/06`, current)
Acted on the evidence instead of the leaderboard instinct:
- **62 % more unique JDs** (815 pairs / 305 postings) — data beats architecture.
- **Combined loss** (CoSENT + CosineSimilarity): gradient signal for ranking *and* absolute score.
- **Calibration fitted on external data**: the 212 external pairs split 106/106 — isotonic &
  Platt calibrators fitted on the first half, final numbers reported only on the untouched second half.

**Final external results (106 unseen pairs):**

| Model | Spearman ↑ | MAE ↓ |
|---|---|---|
| **MPNet + Platt calibration (production)** | **0.8645** | **0.1021** |
| MPNet + isotonic calibration | 0.8667 | 0.1005 |
| MPNet raw (combined loss) | 0.8645 | 0.1325 |
| DistilRoBERTa cross-encoder (aug + reg) | 0.8379 | 0.1816 |
| RoBERTa cross-encoder (aug + reg) | 0.6514 | 0.2209 |

The two calibrators are statistically tied — the 0.002 MAE gap is well inside
run-to-run training noise and the bootstrap confidence interval on a 106-pair test
set. Platt ships because its 2-parameter sigmoid cannot overfit a small calibration
split, while isotonic's step function can (it fits the calibration set noticeably
tighter than it generalizes). Notebook 06 quantifies the tie with a bootstrap.

Batch ranking: 106 resumes scored against one JD in ~1.1 s (T4).

Production v3 (`Notebooks/06`) hardens this result: multi-seed training with
mean ± std reporting, a base-model baseline on the same held-out test, a bootstrap
comparison proving the Platt/isotonic tie, and a recruiter-facing top-candidate
ranking metric — plus HF Hub publishing so the live demo serves the real model.

![Production model comparison](Results/05_production_v2_fig1.png)

---

## Repository map

```
Notebooks/           Research notebooks 01–05 (03–05 with executed outputs)
                     + 06_production_v3.ipynb — the current production run
                       (multi-seed, bootstrap calibrator test, HF Hub publish)
Data/                Training + external test CSVs
Results/             Extracted charts + results_summary.json
models/              platt_calibrator.pkl (production calibrator; weights on HF Hub)
src/train.py         Reproduces the production pipeline end-to-end
app/                 Streamlit demo (score + skill-gap explanation)
tests/               Pytest suite for the pure-Python pipeline pieces
```

## Dataset provenance (honest version)

Job descriptions come from ~1,150 real LinkedIn postings (scraped, then curated to 305
unique JDs across 14 industries and multiple seniority levels). Resume texts and match
scores were **synthetically generated and hand-curated** against those real JDs, with five
labeled match types (`strong`, `good`, `partial`, `hard_negative`, `weak`) — hard negatives
are keyword-dense but wrong-role pairs (e.g., QA-automation Python vs backend Python).
The external test set (212 pairs, 53 JDs) has zero JD overlap with training and includes
deliberately hard edge cases: career changers, overqualified candidates, keyword-stuffed
mismatches. Synthetic labels are the main limitation — scores reflect the labeling rubric,
not recruiter ground truth. That's on the roadmap.

## Reproducing the model

The fine-tuned weights are not stored in this repo (they're ~420 MB). Regenerate them:

```bash
pip install -r requirements.txt
python src/train.py                       # full pipeline: train + calibrate + evaluate
python src/train.py --push-to-hub USER/resume-jd-matcher-mpnet   # optionally publish
```

- **GPU (recommended):** ~1 h on a free Colab T4 — open a notebook, clone the repo, run the same command.
- **CPU:** works, but plan for an overnight run.

`train.py` prints the final external-test table and writes `models/` (model + calibrators)
plus `Results/training_metrics.json`.

## Running the demo app

```bash
pip install -r requirements.txt
streamlit run app/app.py
```

Paste a resume and a job description → calibrated match score, verdict, and a requirement-by-
requirement skill-gap table showing what the resume covers (with the evidence line) and what
it's missing. Optional: set `ANTHROPIC_API_KEY` to add an LLM-written fit critique. Without
the fine-tuned weights on HF Hub the app falls back to base MPNet and says so in a banner.

## What I learned

- **External validation is non-negotiable.** A held-out split from the same JD pool still
  flattered the cross-encoder by 1.5 Spearman points (0.89 vs −0.61).
- **In low-data regimes, smaller + calibrated beats bigger + expressive.** Every
  anti-overfitting trick helped the cross-encoder; none closed the gap.
- **Calibration is a product feature.** Users see the score, not the ranking — a model
  that says "78 % match" for a 16 % match loses trust even when its ordering is right.

## Limitations & next steps

- Synthetic match labels → collect recruiter-labeled pairs for a gold test set
- PDF resume parsing in the app (currently paste-text)
- Score confidence intervals (fold-spread was a useful signal in the K-fold experiment)
- ONNX / quantized export for CPU-cheap serving

---

*David Lepighe · Apr–May 2026 (research), Jul 2026 (app) · [github.com/dlepighe1](https://github.com/dlepighe1)*
