"""Shared test setup: repo root on sys.path + stub encoders.

Every test in this suite runs offline. No test may download a model, hit the
HuggingFace Hub, or call the Anthropic API — the sentence-transformer is always
replaced by a stub encoder with hand-chosen vectors, so assertions about
similarity bands are exact rather than dependent on real embeddings.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


class ScriptedEncoder:
    """Stub SentenceTransformer returning a caller-chosen vector per exact text.

    Lets a test dictate the cosine similarity between any requirement and any
    resume sentence, which is what the skill-gap banding logic actually keys on.
    """

    def __init__(self, vectors: dict[str, list[float]], default: list[float] | None = None):
        self.vectors = vectors
        self.default = default
        self.seen: list[str] = []

    def encode(self, texts, **kwargs):
        self.seen.extend(texts)
        rows = []
        for t in texts:
            if t in self.vectors:
                rows.append(self.vectors[t])
            elif self.default is not None:
                rows.append(self.default)
            else:
                raise KeyError(f"ScriptedEncoder got an unexpected text: {t!r}")
        return np.array(rows, dtype=float)


@pytest.fixture
def scripted_encoder():
    return ScriptedEncoder
