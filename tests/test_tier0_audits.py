"""Tests for the two Tier 0 audits: generation artifacts and behavioural probes.

Both scripts exist to check claims nothing else in this repository checks, which makes their
own correctness load-bearing in an unusually direct way: a bug in either produces a confident
verdict about the model that is really a verdict about the harness.

That is not hypothetical here. The first version of the behavioural suite reported three of
four failures, and all three were harness bugs. `keyword_stuff` appended the full requirement
text, roughly 200 words against a median resume of 106, so it measured what happens when you
paste a posting into a resume rather than what happens when you add unevidenced keywords. And
`shuffle_sections` compared against the untouched resume, so it charged reordering for the
whitespace that splitting and rejoining destroys. Several tests below exist specifically to
keep those two from coming back.

Offline like the rest of the suite. The real runs need the published checkpoint; what is
tested here is the arithmetic and the perturbation logic, on inputs whose answers are known.
"""

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


artifacts = _load("audit_generation_artifacts")
behaviour = _load("behavioral_tests")


# ══ Generation artifacts ══════════════════════════════════════════════════════

class TestTokenizer:
    def test_keeps_the_characters_that_carry_meaning_in_skill_names(self):
        """Stripping them merges `c++` into `c` and `.net` into `net`, which would make two
        different skills look like the same token and inflate every overlap measurement."""
        tokens = artifacts.tokenize("Experience with C++, .NET and C#")
        assert "c++" in tokens
        assert ".net" in tokens
        assert "c#" in tokens

    def test_lowercases_so_casing_does_not_split_a_term(self):
        assert artifacts.tokenize("Python PYTHON python") == ["python"] * 3


class TestNgramOverlap:
    def test_identical_texts_overlap_completely(self):
        tokens = artifacts.tokenize("python and sql and airflow pipelines daily")
        assert artifacts.overlap_rate(tokens, tokens, 2) == 1.0

    def test_disjoint_texts_do_not_overlap(self):
        a = artifacts.tokenize("python sql airflow")
        b = artifacts.tokenize("nursing patient care")
        assert artifacts.overlap_rate(a, b, 2) == 0.0

    def test_normalised_by_the_resume_not_the_posting(self):
        """Postings vary in length by an order of magnitude. Without this the statistic would
        mostly measure how long the posting was."""
        resume = artifacts.tokenize("python and sql")
        short_jd = artifacts.tokenize("python and sql")
        long_jd = artifacts.tokenize("python and sql " + "filler text here " * 50)
        assert artifacts.overlap_rate(resume, short_jd, 2) == \
            artifacts.overlap_rate(resume, long_jd, 2)

    def test_a_resume_shorter_than_the_window_yields_zero_rather_than_dividing_by_zero(self):
        assert artifacts.overlap_rate(["python"], artifacts.tokenize("python sql"), 6) == 0.0

    def test_long_windows_catch_copying_that_short_windows_miss(self):
        """The premise of the whole audit. Sharing skill vocabulary shows up at n=2; sharing
        a sentence shows up at n=6. If both moved together the test could not separate a
        genuine match from a paraphrase."""
        jd = artifacts.tokenize("we need someone experienced in designing and analyzing "
                                "controlled experiments at scale")
        skills_match = artifacts.tokenize("i am experienced in designing dashboards and "
                                          "analyzing user funnels")
        copied = artifacts.tokenize("experienced in designing and analyzing controlled "
                                    "experiments at scale")

        assert artifacts.overlap_rate(skills_match, jd, 2) > 0
        assert artifacts.overlap_rate(skills_match, jd, 6) == 0.0
        assert artifacts.overlap_rate(copied, jd, 6) > 0.5


class TestControlSelection:
    def test_the_control_is_never_the_pair_s_own_posting(self):
        """A control that could be the posting itself would make the excess statistic
        collapse to zero and the audit would report no artifact regardless of the truth."""
        frame = pd.DataFrame({
            "jd": [f"posting-{i}" for i in range(6)],
            "industry": ["data"] * 6,
        })
        controls = artifacts.build_controls(frame, np.random.default_rng(0))
        assert all(frame["jd"].iloc[c] != frame["jd"].iloc[i] for i, c in enumerate(controls))

    def test_the_control_comes_from_the_same_industry_when_one_exists(self):
        """Comparing a DevOps resume against a nursing posting shows near-zero overlap and
        makes ordinary domain vocabulary look like copying."""
        frame = pd.DataFrame({
            "jd": ["a", "b", "c", "d"],
            "industry": ["data", "data", "nursing", "nursing"],
        })
        controls = artifacts.build_controls(frame, np.random.default_rng(0))
        for i, c in enumerate(controls):
            assert frame["industry"].iloc[c] == frame["industry"].iloc[i]

    def test_falls_back_to_any_other_posting_for_a_single_posting_industry(self):
        frame = pd.DataFrame({"jd": ["a", "b", "c"], "industry": ["solo", "data", "data"]})
        controls = artifacts.build_controls(frame, np.random.default_rng(0))
        assert frame["jd"].iloc[controls[0]] != "a"


class TestUniqueTerms:
    def test_a_term_in_two_postings_is_not_unique_to_either(self):
        frame = pd.DataFrame({"jd": ["alpha shared", "beta shared"]})
        unique = artifacts.unique_terms_by_posting(frame)
        assert "shared" not in unique["alpha shared"]
        assert "alpha" in unique["alpha shared"]

    def test_repeated_postings_are_counted_once(self):
        """The same posting appears up to four times, once per candidate. Counting it four
        times would make every one of its terms look non-unique."""
        frame = pd.DataFrame({"jd": ["alpha term", "alpha term", "beta"]})
        unique = artifacts.unique_terms_by_posting(frame)
        assert "alpha" in unique["alpha term"]


class TestResidualise:
    def test_removes_a_perfectly_correlated_control_entirely(self):
        x = np.arange(10, dtype=float)
        assert np.allclose(artifacts.residualise(x, x.copy()), 0, atol=1e-9)

    def test_leaves_an_uncorrelated_variable_essentially_intact(self):
        rng = np.random.default_rng(0)
        x = rng.normal(size=200)
        control = rng.normal(size=200)
        residual = artifacts.residualise(x, control)
        assert np.corrcoef(residual, x)[0, 1] > 0.95


# ══ Behavioural probes ════════════════════════════════════════════════════════

JD = """Security Analyst

Requirements:
- Monitor and analyze security alerts from SIEM platforms such as Splunk or QRadar.
- Apply the NIST Cybersecurity Framework to assess control gaps.
- Write detection content in Python against Elastic data sources.
"""

RESUME = ("Dana Reed is a security analyst with four years of experience.\n"
          "She triaged alerts in Splunk and wrote Python detections daily.\n"
          "She reported findings to the security operations lead each week.\n")


class TestKeywordStuff:
    def test_adds_a_skills_line_rather_than_the_posting(self):
        """The bug this replaced. Appending the requirement sentences added roughly 200 words
        to a 106-word resume, so the perturbed document was mostly job description and cosine
        similarity rose 0.39. That measured pasting, not keyword stuffing."""
        stuffed = behaviour.keyword_stuff(RESUME, JD)
        added = len(stuffed.split()) - len(RESUME.split())

        assert added <= 20, "the addition is the size of a document, not a skills line"
        assert "Monitor and analyze" not in stuffed, "a whole requirement sentence leaked in"

    def test_adds_the_tool_names_a_keyword_scanner_would_target(self):
        stuffed = behaviour.keyword_stuff(RESUME, JD)
        assert "QRadar" in stuffed
        assert "NIST" in stuffed

    def test_does_not_re_add_terms_the_resume_already_evidences(self):
        """Adding Splunk to a resume that already demonstrates Splunk tests nothing: the
        point is unevidenced terms."""
        skills_line = behaviour.keyword_stuff(RESUME, JD)[len(RESUME):]
        assert "Splunk" not in skills_line
        assert "Python" not in skills_line

    def test_respects_the_term_cap(self):
        stuffed = behaviour.keyword_stuff(RESUME, JD, max_terms=2)
        assert stuffed[len(RESUME):].count(",") <= 1

    def test_a_posting_with_no_extractable_requirements_is_left_alone(self):
        assert behaviour.keyword_stuff(RESUME, "") == RESUME


class TestShuffleSections:
    def test_returns_an_order_preserving_control_alongside_the_shuffle(self):
        """Without the control this measures reformatting plus reordering. Splitting a resume
        into sentences and rejoining with single spaces destroys the line breaks, which on
        these resumes is roughly 45 characters, and an earlier version reported that as an
        ordering effect."""
        shuffled, control = behaviour.shuffle_sections(RESUME, np.random.default_rng(0))

        assert sorted(control.split()) == sorted(shuffled.split())
        assert control != RESUME, "the control must be reformatted the same way as the shuffle"

    def test_the_control_keeps_the_original_sentence_order(self):
        from src.text_utils import split_sentences

        _, control = behaviour.shuffle_sections(RESUME, np.random.default_rng(0))
        assert control == " ".join(split_sentences(RESUME))

    def test_the_shuffle_actually_reorders(self):
        """Across seeds, not on one. A genuine shuffle of three sentences returns the
        identity permutation one time in six, so asserting on a single draw would make this
        test fail for the one reason that is not a bug."""
        outcomes = {behaviour.shuffle_sections(RESUME, np.random.default_rng(seed))[0]
                    for seed in range(8)}
        assert len(outcomes) > 1

    def test_a_resume_too_short_to_reorder_is_skipped_rather_than_faked(self):
        assert behaviour.shuffle_sections("One sentence only.", np.random.default_rng(0)) is None


class TestPadIrrelevant:
    def test_keeps_the_original_text_and_appends_filler(self):
        padded = behaviour.pad_irrelevant(RESUME)
        assert padded.startswith(RESUME)
        assert len(padded.split()) > len(RESUME.split())

    def test_the_filler_names_no_skill_from_the_posting(self):
        """If the padding mentioned Python the test would measure keyword addition rather
        than length and register."""
        for term in ("Python", "Splunk", "QRadar", "NIST", "Elastic", "SIEM"):
            assert term not in behaviour.IRRELEVANT_PADDING


class TestVerdicts:
    """`evaluate` turns per-pair deltas into a pass or fail against an expectation written
    before the run. Getting the direction wrong here would silently invert a conclusion."""

    @staticmethod
    def _postings(n):
        return [f"posting-{i // 2}" for i in range(n)]

    def test_a_clear_drop_passes_the_decrease_expectation(self):
        deltas = [-0.05] * 20
        out = behaviour.evaluate("drop", deltas, self._postings(20), "decrease", 200,
                                 np.random.default_rng(0))
        assert out["passed"]

    def test_no_movement_fails_the_decrease_expectation(self):
        """A score that does not move when its own cited evidence is removed is the finding
        the test exists for, and it must not be reported as a pass."""
        out = behaviour.evaluate("drop", [0.0] * 20, self._postings(20), "decrease", 200,
                                 np.random.default_rng(0))
        assert not out["passed"]

    def test_a_rise_fails_the_no_increase_expectation(self):
        out = behaviour.evaluate("stuff", [0.08] * 20, self._postings(20), "no_increase", 200,
                                 np.random.default_rng(0))
        assert not out["passed"]

    def test_a_negligible_change_passes_the_invariance_expectation(self):
        rng = np.random.default_rng(0)
        deltas = list(rng.normal(0, 0.001, 20))
        out = behaviour.evaluate("shuffle", deltas, self._postings(20), "invariant", 200,
                                 np.random.default_rng(0))
        assert out["passed"]

    def test_a_systematic_shift_fails_the_invariance_expectation(self):
        out = behaviour.evaluate("shuffle", [-0.04] * 20, self._postings(20), "invariant", 200,
                                 np.random.default_rng(0))
        assert not out["passed"]

    def test_the_threshold_is_stated_relative_to_the_model_s_own_error(self):
        """0.012 is roughly a tenth of the reported mean absolute error. A threshold pulled
        from nowhere would make every pass and fail below it arbitrary."""
        assert 0.005 < behaviour.MEANINGFUL_MOVE < 0.02


# ══ The committed artifacts ═══════════════════════════════════════════════════

def test_the_artifact_audit_records_a_verdict_either_way():
    import json

    path = REPO_ROOT / "Results" / "generation_artifacts.json"
    if not path.exists():
        pytest.skip("generation_artifacts.json has not been generated")
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert "artifact_detected" in payload
    assert payload["verdict"]
    assert payload["_limitation"], (
        "the audit compares synthetic pairs against synthetic pairs and must say so"
    )


def test_the_behavioural_suite_records_every_expectation_it_set():
    import json

    path = REPO_ROOT / "Results" / "behavioral_tests.json"
    if not path.exists():
        pytest.skip("behavioral_tests.json has not been generated")
    payload = json.loads(path.read_text(encoding="utf-8"))

    names = {t["test"] for t in payload["tests"]}
    assert names == {"drop_evidence", "keyword_stuff", "shuffle_sections", "pad_irrelevant"}
    for test in payload["tests"]:
        assert test["expectation"] in {"decrease", "no_increase", "invariant"}
        assert "passed" in test


def test_the_score_still_responds_to_removing_its_own_evidence():
    """The one behavioural result the product's core claim depends on. If removing the
    sentence the model itself cited stops moving the score, the explanation and the score have
    come apart and `app/explain.py` is describing something the score does not use."""
    import json

    path = REPO_ROOT / "Results" / "behavioral_tests.json"
    if not path.exists():
        pytest.skip("behavioral_tests.json has not been generated")
    payload = json.loads(path.read_text(encoding="utf-8"))

    drop = next(t for t in payload["tests"] if t["test"] == "drop_evidence")
    assert drop["passed"], (
        "the score no longer falls when its cited evidence is removed; the skill-gap "
        "explanation and the score are no longer describing the same thing"
    )
