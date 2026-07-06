"""Data augmentation for resume-JD training pairs.

Mirrors Notebooks/05_production_v2.ipynb: each original pair spawns up to
three varied copies (section shuffle, sentence drop, keyword noise) with
small score jitter, so the model learns matching patterns instead of
memorizing exact text.
"""

import random
import re

import numpy as np
import pandas as pd

SECTION_KEYWORDS = [
    ("SUMMARY", "summary"),
    ("SKILLS", "skills"),
    ("EXPERIENCE", "experience"),
    ("EDUCATION", "education"),
]

KEYWORD_REPLACEMENTS = {
    "Python": "Python programming",
    "JavaScript": "JS/JavaScript",
    "React": "React.js",
    "AWS": "Amazon Web Services",
    "SQL": "SQL databases",
    "Docker": "Docker containers",
    "5+ years": "five or more years",
    "3+ years": "three or more years",
}

AUG_TYPES = ["shuffle", "drop_jd", "drop_resume", "noise"]


def shuffle_sections(text: str) -> str:
    """Reorder resume sections so section order carries no signal."""
    sections = {}
    current = "header"
    lines = []
    for line in text.split("\n"):
        upper = line.strip().upper()
        for keyword, name in SECTION_KEYWORDS:
            if keyword in upper:
                sections[current] = "\n".join(lines)
                current = name
                lines = [line]
                break
        else:
            lines.append(line)
    sections[current] = "\n".join(lines)

    header = sections.get("header", "")
    body = [name for _, name in SECTION_KEYWORDS]
    random.shuffle(body)
    return (header + "".join(sections.get(s, "") for s in body if s in sections)).strip()


def drop_sentences(text: str, rate: float = 0.12) -> str:
    """Remove a fraction of sentences to simulate incomplete postings."""
    sents = re.split(r"(?<=[.!?])\s+|\n", text)
    if len(sents) <= 3:
        return text
    n_drop = min(max(1, int(len(sents) * rate)), len(sents) - 2)
    dropped = set(random.sample(range(1, len(sents)), n_drop))
    return " ".join(s for i, s in enumerate(sents) if i not in dropped).strip()


def keyword_noise(text: str) -> str:
    """Swap a couple of terms for variants to break exact-keyword anchoring."""
    result = text
    for key in random.sample(list(KEYWORD_REPLACEMENTS), min(2, len(KEYWORD_REPLACEMENTS))):
        if key in result:
            result = result.replace(key, KEYWORD_REPLACEMENTS[key], 1)
    return result


def augment_dataset(dataframe: pd.DataFrame, n_aug: int = 3, seed: int = 42) -> pd.DataFrame:
    """Return originals + n_aug varied copies per pair (expects a jd_clean column)."""
    random.seed(seed)
    rng = np.random.default_rng(seed)

    rows = []
    for _, row in dataframe.iterrows():
        rows.append({
            "resume": row["resume"], "jd": row["jd_clean"], "score": row["score"],
            "match_type": row["match_type"], "augmented": False,
        })
        for aug in random.sample(AUG_TYPES, min(n_aug, len(AUG_TYPES))):
            resume, jd = row["resume"], row["jd_clean"]
            if aug == "shuffle":
                resume = shuffle_sections(resume)
            elif aug == "drop_jd":
                jd = drop_sentences(jd)
            elif aug == "drop_resume":
                resume = drop_sentences(resume, 0.08)
            elif aug == "noise":
                resume, jd = keyword_noise(resume), keyword_noise(jd)
            noisy_score = float(np.clip(row["score"] + rng.uniform(-0.02, 0.02), 0.01, 0.99))
            rows.append({
                "resume": resume, "jd": jd, "score": noisy_score,
                "match_type": row["match_type"], "augmented": True,
            })
    return pd.DataFrame(rows)
