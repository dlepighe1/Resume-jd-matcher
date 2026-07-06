"""Tests for the pure-Python pipeline pieces (no model downloads)."""

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.augment import augment_dataset, drop_sentences, keyword_noise, shuffle_sections
from src.text_utils import extract_requirements, preprocess_resume, smart_truncate_jd, split_sentences

SAMPLE_JD = """
Acme Corp is a fast-growing leader in cloud logistics. We were founded in 2010
and pride ourselves on a collaborative culture with offices worldwide.

In this role you will design and maintain data pipelines that power our
analytics platform. You will collaborate with product managers and engineers
to ship features quickly and reliably every quarter.

Requirements:
- 3+ years of experience with Python and SQL for data processing.
- Hands-on experience building ETL pipelines with Airflow or similar tools.
- Strong understanding of statistics and experimental design methods.
- Experience with AWS services such as S3, Lambda, and Redshift.

What we offer: competitive salary, unlimited PTO, health benefits.
Compensation range: $120,000 - $150,000 depending on experience.
Acme is an equal opportunity employer and does not discriminate.
"""

SAMPLE_RESUME = """
Jane Smith
Data Engineer

PROFESSIONAL SUMMARY
Data engineer with four years of experience building batch and streaming pipelines.

TECHNICAL SKILLS
Python, SQL, Airflow, dbt, AWS (S3, Lambda, Redshift), Docker.

PROFESSIONAL EXPERIENCE
Built ETL pipelines in Airflow processing 2TB daily at Beta Analytics.
Designed A/B testing framework used across three product teams.

EDUCATION
B.S. Computer Science, State University.
"""


class TestSmartTruncateJd:
    def test_strips_boilerplate(self):
        cleaned = smart_truncate_jd(SAMPLE_JD)
        assert "equal opportunity employer" not in cleaned.lower()
        assert "$120,000" not in cleaned

    def test_keeps_requirements(self):
        cleaned = smart_truncate_jd(SAMPLE_JD)
        assert "Python and SQL" in cleaned
        assert "Airflow" in cleaned

    def test_respects_word_cap(self):
        long_jd = "word " * 900 + " Requirements: Python needed here."
        assert len(smart_truncate_jd(long_jd, max_words=350).split()) <= 351

    def test_short_jd_unchanged(self):
        short = "Looking for a Python developer with SQL skills for our team."
        assert smart_truncate_jd(short) == short


class TestPreprocessResume:
    def test_truncates_long_resume(self):
        long_resume = "skill " * 500
        assert len(preprocess_resume(long_resume, max_words=350).split()) == 350

    def test_short_resume_unchanged(self):
        assert preprocess_resume(SAMPLE_RESUME) == SAMPLE_RESUME


class TestExtractRequirements:
    def test_finds_requirement_lines(self):
        reqs = extract_requirements(SAMPLE_JD)
        assert reqs, "should extract at least one requirement"
        joined = " ".join(reqs)
        assert "Python" in joined
        assert "Airflow" in joined

    def test_respects_max_items(self):
        assert len(extract_requirements(SAMPLE_JD, max_items=2)) <= 2

    def test_no_requirements_section_falls_back(self):
        text = ("We need someone who can write Python scripts every day. "
                "The candidate should also know SQL databases very well.")
        assert extract_requirements(text)


class TestSplitSentences:
    def test_splits_and_filters_short_fragments(self):
        parts = split_sentences("Short. This is a proper sentence with enough words in it.")
        assert all(len(p) > 15 for p in parts)


class TestAugmentation:
    def test_drop_sentences_shortens(self):
        text = ". ".join(f"This is sentence number {i} in the document" for i in range(10)) + "."
        assert len(drop_sentences(text, rate=0.3)) < len(text)

    def test_drop_sentences_short_text_unchanged(self):
        assert drop_sentences("One. Two.") == "One. Two."

    def test_keyword_noise_preserves_meaningful_text(self):
        noised = keyword_noise("Expert in Python and SQL with Docker experience.")
        assert "SQL" in noised or "Python" in noised or "Docker" in noised

    def test_shuffle_sections_keeps_content(self):
        shuffled = shuffle_sections(SAMPLE_RESUME)
        assert "Airflow" in shuffled
        assert "Jane Smith" in shuffled

    def test_augment_dataset_size_and_scores(self):
        df = pd.DataFrame({
            "resume": [SAMPLE_RESUME] * 4,
            "jd_clean": [smart_truncate_jd(SAMPLE_JD)] * 4,
            "score": [0.9, 0.5, 0.2, 0.01],
            "match_type": ["strong", "partial", "weak", "weak"],
        })
        aug = augment_dataset(df, n_aug=3, seed=42)
        assert len(aug) == 4 * (1 + 3)
        assert (~aug["augmented"]).sum() == 4
        assert aug["score"].between(0.0, 1.0).all()

    def test_augment_deterministic_with_seed(self):
        df = pd.DataFrame({
            "resume": [SAMPLE_RESUME],
            "jd_clean": [smart_truncate_jd(SAMPLE_JD)],
            "score": [0.7],
            "match_type": ["good"],
        })
        a = augment_dataset(df, n_aug=3, seed=42)
        b = augment_dataset(df, n_aug=3, seed=42)
        pd.testing.assert_frame_equal(a, b)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
