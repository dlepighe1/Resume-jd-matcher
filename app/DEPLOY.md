# Deploying the demo to HuggingFace Spaces

Prerequisite: the fine-tuned model is on HF Hub. After rerunning training in Colab
(`Notebooks/05_production_v2.ipynb` or `python src/train.py` in a Colab cell):

```python
model.push_to_hub("dlepighe1/resume-jd-matcher-mpnet")
```

and download `models/isotonic_calibrator.pkl` from the Colab run into this repo's
`models/` folder (it's small — commit it to the Space, not to GitHub).

## Create the Space

1. huggingface.co → New Space → SDK: **Streamlit** → name: `resume-jd-matcher`
2. Upload from this repo: `app/`, `src/`, `requirements.txt`, and `models/isotonic_calibrator.pkl`
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
