"""Skill-gap explanation: match JD requirements against resume evidence.

Deterministic and model-driven — uses the same sentence-transformer embeddings
that produce the match score, so the explanation and the score never disagree
about what the model "sees". No API keys involved.
"""

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.text_utils import extract_requirements, split_sentences

# Cosine-similarity bands between a requirement and its best resume sentence.
# Heuristic thresholds chosen on the external test pairs; embeddings from the
# fine-tuned model separate matched/unmatched requirements more sharply than
# base MPNet, so these are deliberately conservative.
COVERED_THRESHOLD = 0.50
PARTIAL_THRESHOLD = 0.35


@dataclass
class RequirementMatch:
    requirement: str
    status: str          # "covered" | "partial" | "missing"
    similarity: float
    evidence: str        # best-matching resume sentence ("" when missing)


def analyze_skill_gap(model, resume_text: str, jd_text: str, max_requirements: int = 12):
    """Match each JD requirement to its closest resume sentence.

    Returns (matches, coverage_ratio). Empty list when no requirements or
    resume sentences could be extracted.
    """
    requirements = extract_requirements(jd_text, max_items=max_requirements)
    resume_sentences = split_sentences(resume_text)
    if not requirements or not resume_sentences:
        return [], 0.0

    req_embs = model.encode(requirements, show_progress_bar=False, convert_to_numpy=True)
    sent_embs = model.encode(resume_sentences, show_progress_bar=False, convert_to_numpy=True)
    sims = cosine_similarity(req_embs, sent_embs)

    matches = []
    for i, req in enumerate(requirements):
        best_idx = int(np.argmax(sims[i]))
        best_sim = float(sims[i][best_idx])
        if best_sim >= COVERED_THRESHOLD:
            status = "covered"
        elif best_sim >= PARTIAL_THRESHOLD:
            status = "partial"
        else:
            status = "missing"
        matches.append(RequirementMatch(
            requirement=req,
            status=status,
            similarity=best_sim,
            evidence=resume_sentences[best_idx] if status != "missing" else "",
        ))

    covered = sum(1 for m in matches if m.status == "covered")
    partial = sum(0.5 for m in matches if m.status == "partial")
    coverage = (covered + partial) / len(matches)
    return matches, coverage


def verdict_band(score: float) -> tuple[str, str]:
    """Map a calibrated 0-1 score to the verdict bands used in the notebooks."""
    if score >= 0.70:
        return "Strong match", "🟢"
    if score >= 0.50:
        return "Good match", "🔵"
    if score >= 0.30:
        return "Partial match", "🟡"
    if score >= 0.15:
        return "Weak match", "🟠"
    return "Not a match", "🔴"
