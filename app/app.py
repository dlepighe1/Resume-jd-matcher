"""ResumeAI — Streamlit demo: score a resume against a job description.

Run locally:   streamlit run app/app.py
Deploy:        HuggingFace Spaces (Streamlit SDK), app_file: app/app.py

Model resolution order:
  1. Local fine-tuned model in models/mpnet-resume-matcher/ (after src/train.py)
  2. HF Hub repo from the MODEL_ID env var (default: dlepighe1/resume-jd-matcher-mpnet)
  3. Base all-mpnet-base-v2 with a visible warning banner
"""

import os
import pickle
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.explain import analyze_skill_gap, verdict_band
from app.llm_critique import api_key_available, generate_critique
from src.text_utils import preprocess_resume, smart_truncate_jd

MODEL_ID = os.getenv("MODEL_ID", "dlepighe1/resume-jd-matcher-mpnet")
LOCAL_MODEL_DIR = ROOT / "models" / "mpnet-resume-matcher"
CALIBRATOR_PATH = ROOT / "models" / "isotonic_calibrator.pkl"
MIN_WORDS = 50

st.set_page_config(page_title="ResumeAI — Resume ↔ JD Matcher", page_icon="🎯", layout="wide")


@st.cache_resource(show_spinner="Loading matching model…")
def load_model():
    """Returns (model, calibrator_or_None, fine_tuned: bool, source: str)."""
    from sentence_transformers import SentenceTransformer

    calibrator = None
    if CALIBRATOR_PATH.exists():
        with open(CALIBRATOR_PATH, "rb") as f:
            calibrator = pickle.load(f)

    if LOCAL_MODEL_DIR.exists():
        return SentenceTransformer(str(LOCAL_MODEL_DIR)), calibrator, True, "local checkpoint"
    try:
        return SentenceTransformer(MODEL_ID), calibrator, True, f"HF Hub ({MODEL_ID})"
    except Exception:
        return SentenceTransformer("all-mpnet-base-v2"), None, False, "base model (fallback)"


def score_pair(model, calibrator, resume_text: str, jd_text: str) -> float:
    from sklearn.metrics.pairwise import cosine_similarity

    resume = preprocess_resume(resume_text)
    jd = smart_truncate_jd(jd_text, 350)
    r_emb = model.encode([resume], show_progress_bar=False)
    j_emb = model.encode([jd], show_progress_bar=False)
    raw = float(cosine_similarity(r_emb, j_emb)[0][0])
    if calibrator is not None:
        return float(calibrator.predict([raw])[0])
    return max(0.0, min(1.0, raw))


model, calibrator, fine_tuned, model_source = load_model()

st.title("🎯 ResumeAI — Resume ↔ Job Description Matcher")
st.caption(
    "Fine-tuned MPNet embeddings + isotonic calibration · "
    "Spearman 0.867 / MAE 0.100 on 106 held-out pairs from unseen job postings"
)

if not fine_tuned:
    st.warning(
        "⚠️ Fine-tuned model unavailable — running on **base MPNet** (uncalibrated). "
        "Scores will be compressed toward 0.5–0.9. Train with `python src/train.py` "
        "or set the `MODEL_ID` env var to a published model.",
        icon="⚠️",
    )
elif calibrator is None:
    st.info(
        "Fine-tuned model loaded, but no calibrator found — showing raw cosine "
        "similarity. Run `python src/train.py` to produce `models/isotonic_calibrator.pkl`."
    )

col_resume, col_jd = st.columns(2)
with col_resume:
    resume_text = st.text_area("📄 Resume", height=320, placeholder="Paste the full resume text…")
with col_jd:
    jd_text = st.text_area("📋 Job description", height=320, placeholder="Paste the full job posting…")

if st.button("Score match", type="primary", use_container_width=True):
    if len(resume_text.split()) < MIN_WORDS or len(jd_text.split()) < MIN_WORDS:
        st.error(f"Both texts need at least {MIN_WORDS} words for a meaningful score.")
        st.stop()

    with st.spinner("Scoring…"):
        score = score_pair(model, calibrator, resume_text, jd_text)
        matches, coverage = analyze_skill_gap(model, resume_text, jd_text)

    verdict, icon = verdict_band(score)
    m1, m2, m3 = st.columns(3)
    m1.metric("Match score", f"{score:.0%}")
    m2.metric("Verdict", f"{icon} {verdict}")
    m3.metric("Requirements covered", f"{coverage:.0%}" if matches else "n/a")
    st.progress(min(max(score, 0.0), 1.0))

    st.subheader("Why — requirement-by-requirement")
    if not matches:
        st.write("Couldn't extract distinct requirements from this job description — "
                 "the score above is based on overall semantic fit.")
    else:
        status_icon = {"covered": "✅", "partial": "🟡", "missing": "❌"}
        for m in matches:
            with st.expander(f"{status_icon[m.status]} {m.requirement[:110]}", expanded=(m.status == "missing")):
                st.write(f"**Status:** {m.status} · similarity {m.similarity:.2f}")
                if m.evidence:
                    st.write(f"**Closest resume evidence:** _{m.evidence}_")
                else:
                    st.write("No resume content matches this requirement.")

    if len(jd_text.split()) > 350:
        st.caption("Note: the job description was smart-truncated to its highest-signal "
                   "350 words (requirements prioritized, boilerplate stripped) — the same "
                   "preprocessing the model was trained with.")

    st.subheader("AI recruiter critique (optional)")
    if api_key_available():
        with st.spinner("Asking Claude for a critique…"):
            try:
                st.markdown(generate_critique(resume_text, jd_text, score, matches))
            except Exception as e:
                st.info(f"Critique unavailable right now ({type(e).__name__}). "
                        "The score and skill-gap analysis above are unaffected.")
    else:
        st.caption("Set an `ANTHROPIC_API_KEY` (env var or Space secret) to add a "
                   "natural-language critique written by Claude. Everything above "
                   "runs locally without it.")

st.divider()
st.caption(
    f"Model source: {model_source} · "
    "[GitHub](https://github.com/dlepighe1/Resume-jd-matcher) · "
    "Research: 5 notebooks, external validation on 212 pairs from 53 unseen JDs"
)
