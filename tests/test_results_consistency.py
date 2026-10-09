"""Assert that every published number still matches the artifact it was copied from.

Results/results_summary.json is hand-maintained prose-plus-numbers, which makes it the file
most likely to drift. It has drifted before: after two production re-runs it still advertised
0.8355 Spearman and 94.3% precision@1, and scripts/calibrate.py still had 0.8645 typed into
it as a literal. Nothing failed, because a stale number looks exactly like a fresh one.

These tests compare the summary against the machine-written artifacts. They are the reason
the summary can be trusted without re-reading the notebooks.
"""

import json
import re
from pathlib import Path

import numpy as np
import pytest
from scipy.stats import spearmanr

REPO_ROOT = Path(__file__).resolve().parents[1]
RESULTS = REPO_ROOT / "Results"
PORTFOLIO_CARD = REPO_ROOT / "portfolio" / "resume-jd-matcher.md"


def _load(name: str):
    path = RESULTS / name
    if not path.exists():
        pytest.skip(f"{name} has not been generated")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def summary():
    return _load("results_summary.json")


@pytest.fixture(scope="module")
def production():
    return _load("production_results.json")


@pytest.fixture(scope="module")
def audit():
    return _load("audit_results.json")


@pytest.fixture(scope="module")
def significance():
    return _load("significance.json")


@pytest.fixture(scope="module")
def demo_pairs():
    return _load("demo_pairs.json")


@pytest.fixture(scope="module")
def ablation():
    return _load("loss_ablation.json")


@pytest.fixture(scope="module")
def ablation_significance():
    return _load("loss_ablation_significance.json")


@pytest.fixture(scope="module")
def card():
    if not PORTFOLIO_CARD.exists():
        pytest.skip("portfolio card is not present")
    return PORTFOLIO_CARD.read_text(encoding="utf-8")


# ── The published checkpoint is the measured checkpoint ───────────────────────

def test_production_run_was_verified_against_the_hub(production):
    """The single defect that cost this project two full re-runs. fit() saves the
    best-by-validation checkpoint while leaving the final epoch in memory, so it is possible
    to publish one model and report another. The export cell now proves they match."""
    assert production.get("published_verified") is True, (
        "production_results.json does not record a successful publication check. "
        "Run notebook 05's export cell against the published model."
    )


def test_audit_measured_the_same_model_the_production_run_reported(audit, production):
    reported = production["production"]["platt"]
    assert audit["production"]["spearman"] == pytest.approx(reported["spearman"], abs=0.01)
    assert audit["production"]["mae"] == pytest.approx(reported["mae"], abs=0.01)


def test_demo_pairs_reproduce_the_reported_metrics(demo_pairs, production):
    """The per-pair export is what the demo page renders. If it disagrees with the report,
    the page is showing a different model from the one the study describes."""
    true = np.array([p["true"] for p in demo_pairs["pairs"]])
    for column, key in (("finetuned_raw", "raw"), ("finetuned_calibrated", "platt")):
        pred = np.array([p["preds"][column] for p in demo_pairs["pairs"]])
        rho = float(spearmanr(true, pred)[0])
        mae = float(np.mean(np.abs(true - pred)))
        # Predictions are stored rounded to 4 places, which can swap two near-tied ranks.
        assert rho == pytest.approx(production["production"][key]["spearman"], abs=0.005)
        assert mae == pytest.approx(production["production"][key]["mae"], abs=0.005)


# ── The summary matches the artifacts ─────────────────────────────────────────

def test_summary_production_numbers_match_production_results(summary, production):
    s = summary["notebook_05_production"]
    p = production

    assert s["production_seed"] == p["production_seed"]
    for calibrator in ("raw", "platt", "isotonic"):
        assert s["production_MPNet_plus_platt"][calibrator] == p["production"][calibrator], (
            f"summary disagrees with production_results.json on the {calibrator} numbers"
        )
    assert s["aggregate"] == p["aggregate"]
    assert s["baseline_base_mpnet"] == p["baseline_base_mpnet"]
    assert s["cross_encoder_distilroberta"] == p["cross_encoder_distilroberta"]


def test_summary_per_seed_matches_production_results(summary, production):
    by_seed = {str(r["seed"]): r for r in production["per_seed"]}
    for seed, reported in summary["notebook_05_production"]["per_seed_platt"].items():
        assert reported == by_seed[seed]["platt"]


def test_summary_precision_at_1_matches_production_results(summary, production):
    s = summary["notebook_05_production"]["precision_at_1"]
    r = production["ranking"]
    assert (s["hits"], s["groups"]) == (r["hits"], r["groups"])
    assert s["precision_at_1"] == pytest.approx(r["precision_at_1"])


def test_summary_baseline_ladder_matches_the_audit(summary, audit):
    ladder = summary["audit"]["baseline_ladder"]
    for key, audit_key in (("jaccard", "jaccard"), ("tfidf", "tfidf"),
                           ("base_mpnet", "base_mpnet"), ("finetuned_platt", "production")):
        assert ladder[key]["spearman"] == pytest.approx(audit[audit_key]["spearman"], abs=1e-4)


def test_summary_audit_findings_match_the_audit_artifact(summary, audit):
    s = summary["audit"]
    assert s["name_bias"]["group_mean_spread"] == audit["name_bias"]["group_mean_spread"]
    assert s["name_bias"]["verdict_flips"] == audit["name_bias"]["verdict_flips"]
    assert s["calibration"]["ece"] == audit["calibration"]["ece"]
    for match_type, values in audit["by_match_type"].items():
        assert s["by_match_type"][match_type] == values


def test_summary_significance_matches_the_significance_artifact(summary, significance):
    by_pair = {(c["b"], c["metric"]): c for c in significance["comparisons"]}
    mapping = {
        "production_vs_base_mpnet": "base_mpnet",
        "production_vs_claude_opus_4_5": "claude",
        "production_vs_tfidf": "tfidf",
        "production_vs_jaccard": "jaccard",
    }
    for summary_key, engine in mapping.items():
        computed = by_pair[(engine, "spearman")]
        claimed = summary["significance"][summary_key]
        assert claimed["spearman_diff"] == pytest.approx(computed["difference"], abs=1e-4)
        assert claimed["significant"] == computed["significant"]


# ── No stale hardcoded metrics ────────────────────────────────────────────────

def test_claude_comparison_file_cites_the_current_finetuned_numbers(production):
    """This file once carried finetuned_mpnet 0.8645 / 0.1021, from a run two generations
    old, because the value was a literal in scripts/calibrate.py rather than a lookup."""
    path = RESULTS / "claude_benchmark_calibrated.json"
    if not path.exists():
        pytest.skip("claude_benchmark_calibrated.json has not been generated")
    cited = json.loads(path.read_text(encoding="utf-8"))["finetuned_mpnet"]
    reported = production["production"]["platt"]
    assert cited["spearman"] == pytest.approx(reported["spearman"], abs=1e-4)
    assert cited["mae"] == pytest.approx(reported["mae"], abs=1e-4)


def test_calibrator_choice_is_recorded_as_a_tie_not_a_win(summary, production):
    """Platt ships because a 2-parameter sigmoid cannot overfit a 106-pair calibration
    split, not because it beat isotonic. If a future run makes that a real difference, this
    test fails and the justification has to be rewritten rather than silently inherited."""
    assert summary["notebook_05_production"]["calibrator_bootstrap"]["verdict"] == \
        production["calibrator_bootstrap"]["verdict"]
    lo, hi = production["calibrator_bootstrap"]["ci95"]
    assert lo <= 0 <= hi, "the calibrators are now distinguishable; update the rationale"


# ── The loss ablation (notebook 07) ───────────────────────────────────────────

def test_ablation_ran_on_the_shipped_test_split(ablation, demo_pairs):
    """The ablation is only interpretable against notebook 05 if it scored notebook 05's
    pairs. The notebook checks this by fingerprint before training; this checks the artifact
    it actually exported, which is the thing the bootstrap consumed."""
    shipped = {p["id"] for p in demo_pairs["pairs"]}
    got = {p["id"] for p in ablation["pairs"]}
    assert got == shipped, (
        f"{len(got - shipped)} ablation pairs are not in the shipped final test split, so "
        f"the arm comparisons are not paired against the published model"
    )


def test_summary_ablation_arms_match_the_artifact(summary, ablation):
    assert summary["notebook_07_loss_ablation"]["arms"] == ablation["aggregate"]


def test_summary_ablation_per_seed_matches_the_artifact(summary, ablation):
    claimed = summary["notebook_07_loss_ablation"]["per_seed_platt_spearman"]
    for arm in ablation["arms"]:
        computed = {str(r["seed"]): r["platt"]["spearman"]
                    for r in ablation["runs"] if r["arm"] == arm}
        assert claimed[arm] == computed


def test_summary_ablation_significance_matches_the_artifact(summary, ablation_significance):
    by_pair = {(c["b"], c["metric"]): c for c in ablation_significance["comparisons"]}
    mapping = {
        "combined_vs_cosent_spearman": ("cosent_platt", "spearman"),
        "combined_vs_cosent_mae": ("cosent_platt", "mae"),
        "combined_vs_cosine_spearman": ("cosine_platt", "spearman"),
        "combined_vs_cosine_mae": ("cosine_platt", "mae"),
        "combined_vs_cosent_3seed_ensemble_spearman": ("cosent_ensemble_raw", "spearman"),
    }
    claims = summary["notebook_07_loss_ablation"]["significance"]
    for summary_key, key in mapping.items():
        computed = by_pair[key]
        claimed = claims[summary_key]
        assert claimed["difference"] == pytest.approx(computed["difference"], abs=1e-4)
        assert claimed["p_value"] == pytest.approx(computed["p_value"], abs=1e-4)
        assert claimed["significant"] == computed["significant"]


def test_combined_loss_is_still_recorded_as_redundant(summary, ablation_significance):
    """The README says the CosineSimilarity term can come out. That rests on CoSENT alone
    being indistinguishable from the combined objective on both metrics. If a re-run
    separates them, this fails and the claim has to be rewritten rather than inherited."""
    by_pair = {(c["b"], c["metric"]): c for c in ablation_significance["comparisons"]}
    for metric in ("spearman", "mae"):
        comparison = by_pair[("cosent_platt", metric)]
        lo, hi = comparison["ci95"]
        assert lo <= 0 <= hi, (
            f"combined and cosent are now separable on {metric}; the 'drop the "
            f"CosineSimilarity term' conclusion no longer follows"
        )
    assert "H1 SUPPORTED" in ablation_significance["h1_verdict"]
    assert summary["notebook_07_loss_ablation"]["h1_verdict"] == \
        ablation_significance["h1_verdict"]


# ── Multiplicity and equivalence ──────────────────────────────────────────────
# The corrections exist to stop the study over-claiming. These stop the corrections
# themselves from quietly reverting to the uncorrected numbers they replaced.

def test_every_headline_engine_claim_survives_the_multiplicity_correction(significance):
    """The six engine comparisons are the study's answers to its own research questions. If
    a re-run leaves one of them clearing 0.05 raw but not adjusted, the README's summary
    table is overstating a result and has to say so."""
    for c in significance["comparisons"]:
        assert c["family"] == "primary", f"{c['b']}/{c['metric']} left the primary family"
        assert c["significant_holm"], (
            f"production vs {c['b']} on {c['metric']} no longer survives Holm correction "
            f"(raw p={c['p_value']}, adjusted p={c['p_value_holm']}); the README claims it does"
        )


def test_the_claude_comparison_reports_its_adjusted_p_value(summary, significance):
    """The narrowest of the headline claims and the one a reader will check hardest."""
    claim = summary["significance"]["production_vs_claude_opus_4_5"]
    computed = next(c for c in significance["comparisons"]
                    if c["b"] == "claude" and c["metric"] == "spearman")
    assert claim["p_holm"] == pytest.approx(computed["p_value_holm"], abs=1e-4)
    assert claim["significant_holm"] is computed["significant_holm"] is True


def test_the_seed_ensemble_is_not_recorded_as_an_established_win(ablation_significance):
    """This one was reported as significant at p=0.021 before the ablation family was
    corrected, and the README recommended it on that basis. It is exploratory and it does
    not survive Holm. If a re-run changes that, the recommendation can be upgraded, but it
    must not be upgraded silently."""
    ensemble = next(c for c in ablation_significance["comparisons"]
                    if c["b"] == "cosent_ensemble_raw" and c["metric"] == "spearman")
    assert ensemble["family"] == "secondary"
    assert not ensemble["significant_holm"], (
        "the 3-seed ensemble now survives correction; the README's 'evidenced rather than "
        "adopted' framing understates it and should be rewritten"
    )


def test_the_equivalence_margin_is_derived_from_the_two_artifacts(
        ablation_significance, ablation, production):
    """The margin decides every equivalence verdict in the study, so it cannot be a number
    somebody typed. It is the gap between two runs of the identical recipe, and this
    recomputes it from both artifacts rather than trusting the copy in the results file."""
    margins = ablation_significance["equivalence_margins"]
    nb05 = production["aggregate"]["platt"]
    nb07 = ablation["aggregate"]["combined"]["platt"]

    assert margins["spearman"] == pytest.approx(
        abs(nb07["spearman_mean"] - nb05["spearman_mean"]), abs=1e-4)
    assert margins["mae"] == pytest.approx(
        abs(nb07["mae_mean"] - nb05["mae_mean"]), abs=1e-4)
    assert margins["spearman"] > 0, "a zero margin would call every null result equivalent"


def test_the_primary_hypothesis_reports_what_would_settle_it(ablation_significance):
    """An inconclusive primary result is only publishable if it says what it would take to
    resolve. Both metrics must carry a sample size, and both must exceed the 50 postings the
    study actually has, or the 'inconclusive' verdict is inconsistent with its own arithmetic."""
    primary = [c for c in ablation_significance["comparisons"] if c["family"] == "primary"]
    assert {c["metric"] for c in primary} == {"spearman", "mae"}
    for c in primary:
        if c["verdict"] != "inconclusive":
            continue
        needed = c.get("postings_to_resolve_at_margin")
        assert needed and needed > ablation_significance["n_postings"], (
            f"{c['b']}/{c['metric']} is inconclusive but claims the current sample suffices"
        )


def test_summary_records_the_run_to_run_gap_against_both_artifacts(summary, ablation,
                                                                   production):
    """The ablation's combined arm re-runs notebook 05's recipe, so the gap between them is
    the reproducibility finding. Both halves are transcribed into the summary and both are
    checked here, because a hand-copied gap is exactly the kind of number that drifts."""
    finding = summary["notebook_07_loss_ablation"]["_reproducibility_finding"]
    nb07_seed_43 = next(r["raw"]["spearman"] for r in ablation["runs"]
                        if r["arm"] == "combined" and r["seed"] == 43)

    assert finding["aggregate_raw_spearman_notebook_05"] == \
        production["aggregate"]["raw"]["spearman_mean"]
    assert finding["aggregate_raw_spearman_notebook_07_combined_arm"] == \
        ablation["aggregate"]["combined"]["raw"]["spearman_mean"]
    assert finding["seed_43_raw_spearman_notebook_05"] == \
        production["production"]["raw"]["spearman"]
    assert finding["seed_43_raw_spearman_notebook_07"] == nb07_seed_43
    assert finding["aggregate_gap"] == pytest.approx(
        finding["aggregate_raw_spearman_notebook_07_combined_arm"]
        - finding["aggregate_raw_spearman_notebook_05"], abs=1e-4)


# ── The portfolio card is a published surface, so it drifts like any other ────

def test_portfolio_card_cites_the_current_headline(card, production, significance):
    """This card feeds the public site and was the last surface no test covered. It sat for
    weeks advertising 0.8355 Spearman and 94.3% precision@1 from a run that predated the
    publication check, while Results/ said otherwise. Expected strings are derived from the
    artifacts, so changing a number without updating the card fails here."""
    spearman = production["aggregate"]["raw"]["spearman_mean"]
    mae = production["aggregate"]["platt"]["mae_mean"]
    precision = production["ranking"]["precision_at_1"]
    vs_claude = next(c["difference"] for c in significance["comparisons"]
                     if c["b"] == "claude" and c["metric"] == "spearman")

    for expected, label in (
        (f"{spearman:.4f}", "aggregate Spearman"),
        (f"{mae:.4f}", "aggregate Platt MAE"),
        (f"{precision * 100:.1f}%", "precision@1"),
        (f"{vs_claude:.3f}", "Spearman gain over Claude"),
    ):
        assert expected in card, f"portfolio card does not cite the current {label} ({expected})"


def test_portfolio_card_has_no_superseded_headline_metrics(card):
    """Every string here was a headline figure on this card that Results/ had already
    superseded. They came from runs whose published checkpoint was never verified."""
    for stale in ("0.8355", "0.1145", "94.3", "+0.211"):
        assert stale not in card, (
            f"{stale} is a superseded figure from a pre-verification run and should not "
            f"appear on the portfolio card"
        )


def test_documentation_links_point_at_files_that_exist():
    """The README, the spec and the card cross-reference each other and the artifacts. Those
    links are the only navigation this repository has, and a dead one is invisible until a
    reader hits it. `05_production_v2_fig1.png` was renamed once and the card kept pointing at
    the old name, which is the same failure in the gallery."""
    docs = [REPO_ROOT / "README.md", REPO_ROOT / "docs" / "RESEARCH_SPEC.md",
            REPO_ROOT / "docs" / "DATA_CARD.md", REPO_ROOT / "docs" / "VALIDATION_ROADMAP.md"]

    # Backticked paths are checked too, not only markdown links. RESEARCH_SPEC.md and
    # DATA_CARD.md cite every artifact that way and contain no markdown links at all, so a
    # link-only check would pass over both files without reading a single reference.
    #
    # A directory component is required. Bare filenames like `train.py` are prose shorthand
    # rather than references, and resolving them would mean guessing which directory the
    # sentence meant.
    path_like = re.compile(r"`([\w.-]+/[\w./-]+\.(?:md|json|jsonl|py|csv|ipynb|cff|toml|ts|tsx|yml))`")

    # Cited on purpose, absent on purpose. Both are correct references and neither can be
    # resolved inside this repository.
    unresolvable = {
        "Results/training_metrics.json",  # written by a training run, not committed
        "docs/SPEC.md",                   # lives in the Job-hunterAI repository
    }

    broken = []
    for doc in docs:
        if not doc.exists():
            broken.append(f"{doc.name} is referenced by this test but does not exist")
            continue
        text = doc.read_text(encoding="utf-8")

        for target in re.findall(r"\]\((?!https?://|#)([^)#]+)", text):
            if not (doc.parent / target).resolve().exists():
                broken.append(f"{doc.name} links to missing {target}")

        for target in path_like.findall(text):
            if "*" in target or target in unresolvable:
                continue
            if not (REPO_ROOT / target).exists():
                broken.append(f"{doc.name} cites missing `{target}`")

    assert not broken, "\n".join(broken)


def test_the_validation_roadmap_is_reachable_from_the_published_surfaces():
    """The roadmap is what turns "the labels are synthetic" from a disclaimer into a plan. It
    is only worth writing if a reader can find it, so every surface that states the limitation
    has to point at it."""
    for path in (REPO_ROOT / "README.md", REPO_ROOT / "docs" / "RESEARCH_SPEC.md",
                 PORTFOLIO_CARD):
        if not path.exists():
            continue
        assert "VALIDATION_ROADMAP.md" in path.read_text(encoding="utf-8"), (
            f"{path.name} does not reference the validation roadmap"
        )


def test_portfolio_card_frontmatter_is_valid_yaml(card):
    """The card's frontmatter drives a public site. Everything else about it is guarded by
    content tests that read it as text, which would happily pass on a file the site cannot
    parse. An unquoted colon inside one of the long prose fields is all it takes."""
    yaml = pytest.importorskip("yaml", reason="pyyaml is not installed")

    frontmatter = re.match(r"^---\n(.*?)\n---\n", card, re.S)
    assert frontmatter, "card no longer opens with a YAML frontmatter block"

    parsed = yaml.safe_load(frontmatter.group(1))
    for field in ("title", "slug", "outcome", "nextSteps", "keyInsights", "githubUrl"):
        assert field in parsed, f"card frontmatter lost the {field} field"
    assert isinstance(parsed["nextSteps"], list) and parsed["nextSteps"]
    assert isinstance(parsed["keyInsights"], list) and parsed["keyInsights"]


def test_portfolio_card_only_references_figures_that_exist(card):
    """`05_production_v2_fig1.png` was renamed to `..._LEGACY.png` and the card kept
    pointing at the old name, so the gallery would have rendered broken images.

    Every image the card names is matched, whichever field carries it: the `image:` rows
    inside `resultImages`, the hero `image:`, and any bare list entry. The card's figures
    live in two directories, because the ones this repository generates for the study are in
    Results/ while the ones written for the portfolio are in docs/images/, so a name is
    accepted if either holds it."""
    directories = (RESULTS, REPO_ROOT / "docs" / "images")

    referenced = set(re.findall(
        r"^\s*(?:-\s*|(?:image|trainingCurve|confusionMatrix):\s*)([\w.\-]+\.(?:png|jpg|jpeg))"
        r"\s*(?:#.*)?$",
        card, re.MULTILINE))
    assert referenced, "no figures referenced; the regex or the card format changed"

    missing = [name for name in sorted(referenced)
               if not any((directory / name).exists() for directory in directories)]
    assert not missing, (
        "portfolio card references figures that exist in neither "
        f"{RESULTS.name}/ nor docs/images/: {', '.join(missing)}"
    )


def _card_frontmatter(card: str) -> dict:
    yaml = pytest.importorskip("yaml", reason="pyyaml is not installed")
    frontmatter = re.match(r"^---\n(.*?)\n---\n", card, re.S)
    assert frontmatter, "card no longer opens with a YAML frontmatter block"
    return yaml.safe_load(frontmatter.group(1))


def test_portfolio_card_matches_the_studio_schema(card):
    """The card is pasted into a Sanity Studio, and the Studio silently ignores a field it
    does not define or a value of the wrong shape. Three mismatches shipped that way: the
    insights were plain strings where the schema wants {title, description} objects, the
    figures sat in `confusionMatrix` and `trainingCurve`, which the frontend reads but the
    schema never defined, and the required `sortOrder` was absent entirely. None of it would
    have raised anything; the page would just have rendered short."""
    parsed = _card_frontmatter(card)

    # The six fields the schema marks required.
    for field in ("title", "slug", "description", "category", "projectType", "sortOrder"):
        assert field in parsed, f"card is missing the required field {field}"
    assert parsed["projectType"] == "ai_ml_case_study"
    assert parsed["category"] in {"Software", "Data Science", "UI/UX Design", "AI Innovations"}
    assert isinstance(parsed["sortOrder"], int) and parsed["sortOrder"] >= 1

    # Fields the schema does not define. Filling them renders nothing at all.
    for absent in ("confusionMatrix", "trainingCurve"):
        assert absent not in parsed, (
            f"{absent} is read by the frontend but absent from schemaTypes/projectType.ts, "
            f"so it cannot be filled from the Studio. Put the image in resultImages instead"
        )

    # A metric renders as a count-up tile when it carries `value` and as a Highlights card
    # when it carries `textValue`. Setting both is ambiguous and setting neither renders a
    # bare label.
    for group in ("resultsMetrics", "impact", "result", "highlightMetrics"):
        for metric in parsed.get(group, []):
            assert "label" in metric, f"{group} entry without a label"
            assert ("value" in metric) != ("textValue" in metric), (
                f"{group} entry {metric['label']!r} must set exactly one of value, textValue"
            )
            if "value" in metric:
                assert isinstance(metric["value"], int | float)

    for group in ("keyInsights", "keyInsightsShared"):
        for insight in parsed.get(group, []):
            assert set(insight) == {"title", "description"}, (
                f"{group} entries are {{title, description}} objects in the schema, not strings"
            )

    # The two insight lists are the same section rendered by different layouts, so they are
    # kept identical on purpose. Letting them drift means the page says one thing on one
    # layout and something else on another, with nothing to catch it.
    if parsed.get("keyInsightsShared"):
        assert parsed["keyInsightsShared"] == parsed["keyInsights"], (
            "keyInsightsShared and keyInsights have drifted apart. Mirror them, or clear one"
        )

    for figure in parsed.get("resultImages", []):
        assert set(figure) == {"title", "image", "caption"}, (
            "resultImages entries are {title, image, caption} objects"
        )

    for challenge in parsed.get("challengesSolutions", []):
        assert set(challenge) == {"challenge", "solution"}


def test_portfolio_figures_are_generated(card):
    """`scripts/make_portfolio_figures.py` renders the card's figures from committed
    artifacts. The card names them, so a figure that was never generated is a broken image
    on a public page rather than a missing file anyone would notice locally."""
    images = REPO_ROOT / "docs" / "images"
    for name in ("portfolio-cover.jpg", "fig-engine-ladder.png",
                 "fig-behavioral-tests.png", "fig-calibration.png"):
        assert (images / name).exists(), (
            f"docs/images/{name} is missing. Run python scripts/make_portfolio_figures.py"
        )

    parsed = _card_frontmatter(card)
    assert parsed.get("image"), "the card has no hero image, which is also the /projects card"
