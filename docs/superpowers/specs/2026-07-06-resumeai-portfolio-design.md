# ResumeAI Portfolio & Demo App — Design Spec

**Date:** 2026-07-06 · **Approved by:** David (in conversation) · **Status:** approved, implementation in progress

## Goal

Turn the five ResumeAI Colab notebooks (Apr 28 – May 5, 2026) into a hire-worthy data-science
portfolio piece: an organized repo with the research narrative, a portfolio metadata file for
David's online portfolio, a reproducible training script, and a Streamlit demo app deployable
to HuggingFace Spaces.

## Decisions (from Q&A)

| Question | Decision |
|---|---|
| Model weights | Lost with Colab runtime. David reruns the Production_v2 notebook (or `src/train.py`) in Colab to regenerate weights, then downloads / pushes them to HF Hub. Local machine has **no NVIDIA GPU**, so local retraining is CPU-only (slow but supported). |
| App shape | Streamlit on HuggingFace Spaces (free hosting, live demo URL). |
| Explanations | Both: deterministic skill-gap analysis (always on, uses the fine-tuned embeddings) + optional LLM critique when an API key is configured. |
| Portfolio file format | Markdown with YAML frontmatter, fields matching the SentimentScope-style template. |

## Final metrics (from executed notebooks — source of truth)

- Production model: fine-tuned `all-mpnet-base-v2` (combined CoSENT + CosineSimilarity loss) + isotonic calibration.
- External final test (106 pairs, unseen JDs): **Spearman 0.8667, MAE 0.1005** (isotonic); Platt variant 0.8645 / 0.1021.
- Training data: 815 pairs from 305 unique JDs; external set 212 pairs from 53 unseen JDs (split 106 calibration / 106 final test).
- Key negative results (kept, they are the story): RoBERTa cross-encoder hit 0.89 Spearman internally but **-0.61 externally** (overfitting); augmentation/regularization/K-fold fixes improved it to at best 0.51 external — never beating the calibrated bi-encoder.

## Deliverables

1. **`Notebooks/01..05_*.ipynb`** — the five notebooks copied from Downloads, renamed in story order, executed versions where available (03, 04, 05).
2. **`Results/`** — charts extracted from executed notebooks + `results_summary.json` with the final metrics table.
3. **`README.md`** — case study: problem, data, method, the overfitting arc, final results table, repo map, honest dataset-provenance and limitations sections.
4. **`portfolio/resume-jd-matcher.md`** — YAML frontmatter (title, slug, projectType, category, status, tags, timeline, role, image, descriptions, problem/goal/outcome, dataset*, model*, pipelineSteps, resultsMetrics, challengesSolutions, keyInsights, impact, whatILearned, nextSteps, demoUrl, gallery, githubUrl) with real numbers only.
5. **`src/train.py`** — reproduces the Production_v2 pipeline from `Data/*.csv`: smart JD truncation → 3× augmentation → MPNet combined-loss fine-tune → isotonic + Platt calibration on external calibration split → final-test eval → saves model, calibrators, metrics JSON. Flags: `--epochs --batch-size --output-dir --push-to-hub <repo_id> --eval-only`. Device auto-detect (CUDA→CPU). Runs unchanged in Colab.
6. **`app/`** — Streamlit app: paste resume + JD → calibrated score, verdict band, skill-gap table (requirements extracted from JD, matched to resume sentences via the fine-tuned embeddings, with evidence lines), optional LLM critique (Anthropic key via Space secret / env; app fully functional without). Loads model from HF Hub with graceful fallback to base MPNet + warning banner when the fine-tuned repo isn't available yet.
7. **`tests/`** — pytest for preprocessing, augmentation, and skill-extraction functions (pure-Python parts; no model download in CI).
8. **`requirements.txt`, `.gitignore`** — repo hygiene.

## Error handling

- App: minimum input length guard (~50 words each), truncation notice for very long texts, model-load failure → base-model fallback with visible warning, LLM errors → non-fatal notice.
- train.py: clear errors for missing CSVs; deterministic seeds (42) throughout.

## Out of scope (YAGNI)

PDF resume parsing, user accounts, batch ranking UI, multilingual support — listed as next steps in the portfolio file, not built now.
