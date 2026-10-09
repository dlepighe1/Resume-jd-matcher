"""Skill-gap explanation: match JD requirements against resume evidence.

Deterministic and model-driven, uses the same sentence-transformer embeddings
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
#
# These were 0.50 and 0.35, hand-picked, with no measurement behind them. They are now
# swept on the 106-pair external CALIBRATION half and reported on the untouched 106-pair
# final test, the same discipline the score calibrator follows. Moving them cost the old
# pair 0.0833 Spearman and 0.0518 AUC against the match label on data neither pair was
# chosen on, both intervals excluding zero. See scripts/eval_explanations.py and
# Results/explanation_eval.json.
#
# The old values were too low because the fine-tuned model pushes related text well above
# the cosine floor that any two English documents share, so 0.50 marked as "covered" a
# great deal that merely sat in the same domain as the requirement.
#
# Scope of the evidence, because it is narrower than the change: what was measured is the
# aggregate coverage number, not whether an individual requirement was correctly banded.
# Grading that needs a human to read the requirement against the sentence cited for it, and
# no such labels exist in this repository.
COVERED_THRESHOLD = 0.65
PARTIAL_THRESHOLD = 0.55


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
