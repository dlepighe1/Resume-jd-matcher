# Deploying the demo to HuggingFace Spaces

Prerequisite: the fine-tuned model is on HF Hub. Run `Notebooks/06_production_v3.ipynb`
in Colab — its final cell pushes the model, both calibrators, and a model card to
`dlepighe1/resume-jd-matcher-mpnet` automatically. Also download `platt_calibrator.pkl`
from the run into this repo's `models/` folder (tiny — it's committed to git).

## Create the Space

1. huggingface.co → New Space → SDK: **Streamlit** → name: `resume-jd-matcher`
2. Upload from this repo: `app/`, `src/`, `requirements.txt`, and `models/platt_calibrator.pkl`
3. Add a `README.md` header to the Space so it uses the right entry point:

```yaml
---
title: ResumeAI — Resume ↔ JD Matcher
emoji: 🎯
sdk: streamlit
app_file: app/app.py
pinned: false
---
```

4. (Optional) Space Settings → Variables and secrets:
   - `MODEL_ID` = `dlepighe1/resume-jd-matcher-mpnet` (only needed if you used a different repo name)
   - `ANTHROPIC_API_KEY` = your key, to enable the Claude critique panel

5. Once live, put the Space URL into `portfolio/resume-jd-matcher.md` → `demoUrl`
   and the README's live-demo row.

## Local run

```bash
pip install -r requirements.txt
streamlit run app/app.py
```

Without the fine-tuned weights the app falls back to base MPNet and shows a warning banner — everything still works for UI testing.
