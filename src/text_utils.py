"""Shared text preprocessing for training and the demo app.

Mirrors the preprocessing used in Notebooks/05_production_v2.ipynb so that
scores produced by the app match the conditions the model was trained under.
"""

import re

BOILERPLATE_PATTERNS = [
    r"equal opportunity employer.*",
    r"does not discriminate.*",
    r"reasonable accommodation.*",
    r"(compensation|salary|pay) range.*",
    r"(what we offer|our benefits|perks and benefits|benefits:).*",
]

REQUIREMENT_SECTION_PATTERNS = [
    r"(requirements?|qualifications?|what you.?ll need|must have)",
    r"(responsibilities|what you.?ll do|in this role|you will)",
]


def smart_truncate_jd(jd_text: str, max_words: int = 350) -> str:
    """Strip boilerplate and prioritize the requirements section of a JD.

    Most JDs bury requirements near the end, after company intro and perks —
    exactly the part standard 512-token truncation cuts off. This keeps the
    first ~100 words of context plus everything from the requirements onward.
    """
    cleaned = jd_text
    for pattern in BOILERPLATE_PATTERNS:
        cleaned = re.split(pattern, cleaned, flags=re.IGNORECASE)[0]

    best_start = 0
    for pattern in REQUIREMENT_SECTION_PATTERNS:
        match = re.search(pattern, cleaned, re.IGNORECASE)
        if match:
            start = max(0, match.start() - 200)
            if best_start == 0 or start < best_start:
                best_start = start

    if best_start > 100:
        cleaned = cleaned[:100] + "\n" + cleaned[best_start:]

    words = cleaned.split()
    if len(words) > max_words:
        return " ".join(words[:max_words]).strip()
    return cleaned.strip()


def preprocess_resume(resume_text: str, max_words: int = 350) -> str:
    """Length management for resumes; content is kept as-is."""
    words = resume_text.split()
    if len(words) > max_words:
        return " ".join(words[:max_words])
    return resume_text


def split_sentences(text: str) -> list[str]:
    """Split text into sentence/bullet units for evidence matching."""
    parts = re.split(r"(?<=[.!?])\s+|\n+|•|•|- (?=[A-Z])", text)
    return [p.strip(" -•\t") for p in parts if p and len(p.strip()) > 15]


def extract_requirements(jd_text: str, max_items: int = 12) -> list[str]:
    """Pull individual requirement statements out of a JD.

    Finds the requirements/responsibilities section and returns its bullet or
    sentence units. Falls back to the highest-signal sentences of the whole JD
    when no explicit section exists.
    """
    cleaned = smart_truncate_jd(jd_text, max_words=600)

    section_start = None
    for pattern in REQUIREMENT_SECTION_PATTERNS:
        match = re.search(pattern, cleaned, re.IGNORECASE)
        if match and (section_start is None or match.start() < section_start):
            section_start = match.start()

    scope = cleaned[section_start:] if section_start is not None else cleaned
    units = split_sentences(scope)

    # Drop section headers themselves ("Requirements:", "What you'll do")
    units = [
        u for u in units
        if len(u.split()) >= 4
        and not re.fullmatch(r"(requirements?|qualifications?|responsibilities)\s*:?", u, re.IGNORECASE)
    ]
    return units[:max_items]
