"""Optional LLM-written fit critique via the Claude API.

The app is fully functional without this — it only activates when an
ANTHROPIC_API_KEY is available (env var or Streamlit secret). The critique
is grounded in the model's own outputs (score + skill-gap analysis) so the
LLM narrates the evidence rather than re-judging the pair from scratch.
"""

import os

CRITIQUE_MODEL = "claude-opus-4-8"

SYSTEM_PROMPT = (
    "You are a senior technical recruiter reviewing a candidate against a job "
    "description. You are given the resume, the job description, a calibrated "
    "match score from a fine-tuned matching model, and a requirement-by-"
    "requirement skill-gap analysis. Write a short, honest fit critique for the "
    "candidate: why the score is what it is, the 2-3 strongest alignment points, "
    "the gaps that matter most, and one concrete suggestion to improve the "
    "resume for this posting. Ground every claim in the provided texts — do not "
    "invent experience the resume doesn't show. Keep it under 250 words, plain "
    "prose with short paragraphs, no headers."
)


def api_key_available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def generate_critique(resume_text: str, jd_text: str, score: float, matches) -> str:
    """Return a natural-language fit critique. Raises on API errors —
    the caller decides how to surface them."""
    import anthropic

    gap_lines = "\n".join(
        f"- [{m.status.upper()}] {m.requirement}"
        + (f" | evidence: {m.evidence}" if m.evidence else "")
        for m in matches
    )
    user_prompt = (
        f"Calibrated match score: {score:.0%}\n\n"
        f"Skill-gap analysis:\n{gap_lines or '(no requirements extracted)'}\n\n"
        f"--- JOB DESCRIPTION ---\n{jd_text[:6000]}\n\n"
        f"--- RESUME ---\n{resume_text[:6000]}"
    )

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=CRITIQUE_MODEL,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")
