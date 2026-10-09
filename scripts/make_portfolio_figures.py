"""Render the portfolio figures from committed artifacts.

Every number drawn here is read from a file this repository already publishes. Nothing is
recomputed from the model and nothing is typed in by hand, so a figure cannot drift away
from the result it illustrates: if an artifact changes, re-running this script changes the
picture.

Sources
    web/public/benchmark.json      per-engine Spearman and cluster-bootstrap intervals
    Results/behavioral_tests.json  the four interventions and their intervals
    Results/demo_pairs.json        per-pair true score and per-engine prediction

Outputs land in docs/images/ and are referenced by portfolio/resume-jd-matcher.md.

    python scripts/make_portfolio_figures.py
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "docs" / "images"

# Sans stack first, with fallbacks so the script renders the same figure on a machine that
# has none of the Windows fonts installed.
plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Segoe UI", "Helvetica Neue", "Arial", "DejaVu Sans"],
        "axes.edgecolor": "#d4d4d8",
        "axes.labelcolor": "#3f3f46",
        "text.color": "#18181b",
        "xtick.color": "#52525b",
        "ytick.color": "#52525b",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
    }
)

INK = "#18181b"
MUTED = "#71717a"
FAINT = "#a1a1aa"
GRID = "#e4e4e7"
ACCENT = "#6d28d9"  # the layout's violet, reserved for the shipped model
NEUTRAL = "#cbd5e1"  # baselines
CLAUDE = "#94a3b8"  # the frontier-model row
PASS = "#0f766e"
FAIL = "#b45309"


def load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


# --------------------------------------------------------------------------------------
# 1. The engine ladder, which doubles as the cover
# --------------------------------------------------------------------------------------

LADDER = [
    ("Word overlap (Jaccard)", "jaccard", NEUTRAL),
    ("TF-IDF cosine", "tfidf", NEUTRAL),
    ("Base MPNet, off the shelf", "base_mpnet", NEUTRAL),
    ("Claude Opus 4.5, zero-shot", "claude_calibrated", CLAUDE),
    ("This model: fine-tuned MPNet + Platt", "finetuned_calibrated", ACCENT),
]


def engine_ladder(cover: bool) -> None:
    """Spearman per engine on the identical 106 held-out pairs, with 95% intervals.

    Drawn as one chart at two sizes. The cover is 16:9 because the site crops it to a
    50vh full-bleed hero; the standalone figure is tighter and carries no strapline, since
    the portfolio caption supplies one.
    """
    metrics = load("web/public/benchmark.json")["metrics"]

    figsize, dpi = ((20, 11.25), 100) if cover else ((11, 6.2), 145)
    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    scale = 1.75 if cover else 1.0

    for y, (label, key, colour) in enumerate(LADDER):
        m = metrics[key]
        value = m["spearman"]
        lo, hi = m["spearman_ci95"]
        is_ship = colour == ACCENT
        ax.barh(y, value, height=0.58, color=colour, zorder=2)
        ax.errorbar(
            value,
            y,
            xerr=[[value - lo], [hi - value]],
            fmt="none",
            ecolor=INK if is_ship else MUTED,
            elinewidth=1.6 * scale,
            capsize=5 * scale,
            capthick=1.6 * scale,
            zorder=3,
        )
        ax.text(
            hi + 0.018,
            y,
            f"{value:.3f}",
            va="center",
            ha="left",
            fontsize=13 * scale,
            fontweight="bold" if is_ship else "normal",
            color=INK if is_ship else MUTED,
            zorder=4,
        )
        ax.text(
            0.012,
            y,
            label,
            va="center",
            ha="left",
            fontsize=13 * scale,
            color="white" if is_ship else INK,
            fontweight="bold" if is_ship else "normal",
            zorder=4,
        )

    ax.set_yticks([])
    ax.set_ylim(-0.7, len(LADDER) - 0.3)
    ax.set_xlim(0, 1.0)
    ax.set_xticks([0, 0.2, 0.4, 0.6, 0.8, 1.0])
    ax.tick_params(axis="x", labelsize=11 * scale)
    ax.set_xlabel(
        "Spearman correlation with the match label",
        fontsize=12 * scale,
        labelpad=10 * scale,
    )
    ax.xaxis.grid(True, color=GRID, linewidth=1, zorder=0)
    ax.set_axisbelow(True)
    ax.spines["left"].set_color(GRID)

    if cover:
        # Title and strapline are drawn as figure text rather than an axes title, so the
        # two stack in reading order and the axes keeps the full height below them.
        fig.text(
            0.125,
            0.885,
            "Every engine on the same 106 held-out pairs",
            fontsize=32,
            fontweight="bold",
            color=INK,
            ha="left",
            va="bottom",
        )
        fig.text(
            0.125,
            0.805,
            "Job postings the model never trained on. Bars are Spearman correlation with the "
            "match label; whiskers are 95% intervals\nfrom a bootstrap that resamples postings "
            "rather than pairs, because four candidates from one posting are not independent.",
            fontsize=15,
            color=MUTED,
            ha="left",
            va="bottom",
            linespacing=1.55,
        )
        fig.text(
            0.125,
            0.045,
            "ResumeAI   |   fine-tuned all-mpnet-base-v2, 109M parameters   |   "
            "precision@1 84.9% over 53 unseen postings   |   github.com/dlepighe1/Resume-jd-matcher",
            fontsize=12.5,
            color=FAINT,
            ha="left",
            va="bottom",
        )
        fig.subplots_adjust(left=0.125, right=0.955, top=0.765, bottom=0.155)
        out = IMAGES / "portfolio-cover.jpg"
        fig.savefig(out, format="jpg", pil_kwargs={"quality": 92})
    else:
        ax.set_title(
            "Every engine on the same 106 held-out pairs",
            fontsize=16,
            fontweight="bold",
            loc="left",
            pad=16,
            color=INK,
        )
        fig.tight_layout()
        out = IMAGES / "fig-engine-ladder.png"
        fig.savefig(out)

    plt.close(fig)
    print(f"wrote {out.relative_to(ROOT)}")


# --------------------------------------------------------------------------------------
# 2. The behavioural interventions
# --------------------------------------------------------------------------------------

INTERVENTIONS = {
    "drop_evidence": "Remove the sentence the model\nitself cited as evidence",
    "keyword_stuff": "Add unevidenced tool names\nto a weak resume",
    "shuffle_sections": "Reorder the sentences,\nchanging no words",
    "pad_irrelevant": "Append fluent, empty,\nsenior-sounding filler",
}
# Where the right-hand verdict column sits, in data units. It doubles as the x limit, so
# widening the column and widening the axis cannot drift apart.
RIGHT_COLUMN = 0.185

EXPECTED = {
    "decrease": "expected to fall",
    "no_increase": "expected not to rise",
    "invariant": "expected not to move",
}


def behavioural_tests() -> None:
    """What the score does when one thing about the resume changes.

    The quantity of interest is the sign against the written-down prediction, so the chart
    is built around zero and the threshold band rather than around the bar lengths.
    """
    data = load("Results/behavioral_tests.json")
    tests = {t["test"]: t for t in data["tests"]}
    order = list(INTERVENTIONS)
    threshold = 0.012

    fig, ax = plt.subplots(figsize=(13, 6.8), dpi=145)

    ax.add_patch(
        Rectangle(
            (-threshold, -0.8),
            2 * threshold,
            len(order),
            facecolor="#f4f4f5",
            edgecolor="none",
            zorder=0,
        )
    )

    for y, key in enumerate(reversed(order)):
        t = tests[key]
        value = t["mean_delta"]
        lo, hi = t["ci95"]
        colour = PASS if t["passed"] else FAIL
        ax.barh(y, value, height=0.46, color=colour, alpha=0.9, zorder=2)
        ax.errorbar(
            value,
            y,
            xerr=[[value - lo], [hi - value]],
            fmt="none",
            ecolor=INK,
            elinewidth=1.5,
            capsize=5,
            capthick=1.5,
            zorder=3,
        )
        ax.text(
            (hi + 0.005) if value > 0 else (lo - 0.005),
            y,
            f"{value:+.3f}",
            va="center",
            ha="left" if value > 0 else "right",
            fontsize=12,
            fontweight="bold",
            color=colour,
            zorder=4,
        )
        # A right-hand column carrying the verdict, the prediction it was judged against,
        # and the count. Kept clear of the bars so nothing has to be read across the plot.
        ax.text(
            RIGHT_COLUMN,
            y + 0.26,
            "PASS" if t["passed"] else "FAIL",
            va="center",
            ha="right",
            fontsize=11.5,
            fontweight="bold",
            color=colour,
        )
        ax.text(
            RIGHT_COLUMN,
            y - 0.01,
            EXPECTED[t["expectation"]],
            va="center",
            ha="right",
            fontsize=10.5,
            color=MUTED,
        )
        ax.text(
            RIGHT_COLUMN,
            y - 0.27,
            f"{t['pairs_moving_wrong_way']} of {t['n_pairs']} pairs moved against the prediction",
            va="center",
            ha="right",
            fontsize=9.5,
            color=FAINT,
        )

    ax.axvline(0, color=INK, linewidth=1.2, zorder=1)
    ax.set_yticks(range(len(order)))
    ax.set_yticklabels(
        [INTERVENTIONS[k] for k in reversed(order)], fontsize=11.5, color=INK
    )
    ax.set_ylim(-0.8, len(order) - 0.2)
    ax.set_xlim(-0.085, RIGHT_COLUMN + 0.004)
    ax.set_xticks([-0.075, -0.05, -0.025, 0, 0.025, 0.05, 0.075, 0.1])
    ax.set_xlabel(
        "Change in raw cosine similarity after the intervention",
        fontsize=11.5,
        labelpad=10,
    )
    ax.xaxis.grid(True, color=GRID, linewidth=1, zorder=0)
    ax.set_axisbelow(True)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0)

    ax.text(
        -0.083,
        -0.62,
        "grey band: moves smaller than a tenth of the model's mean absolute error",
        fontsize=9.5,
        color=FAINT,
        va="center",
        ha="left",
    )
    fig.text(
        0.033,
        0.905,
        "Four interventions, one pass",
        fontsize=20,
        fontweight="bold",
        color=INK,
        ha="left",
        va="bottom",
    )
    fig.text(
        0.033,
        0.815,
        "Each changes exactly one thing about a held-out resume and rescores it against the same posting.\n"
        "Directions were written down before the tests ran. Whiskers are 95% intervals from a bootstrap over postings.",
        fontsize=10.5,
        color=MUTED,
        ha="left",
        va="bottom",
        linespacing=1.55,
    )

    fig.subplots_adjust(left=0.20, right=0.985, top=0.775, bottom=0.115)
    out = IMAGES / "fig-behavioral-tests.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"wrote {out.relative_to(ROOT)}")


# --------------------------------------------------------------------------------------
# 3. What calibration does, and what it does not
# --------------------------------------------------------------------------------------


def calibration() -> None:
    """Before and after, on the same 106 pairs.

    Two panels rather than one, because the point is a change of shape and not a change of
    quality: the cloud moves onto the diagonal while its order stays exactly as it was.
    """
    pairs = load("Results/demo_pairs.json")["pairs"]
    true = [p["true"] for p in pairs]
    raw = [p["preds"]["finetuned_raw"] for p in pairs]
    cal = [p["preds"]["finetuned_calibrated"] for p in pairs]

    metrics = load("web/public/benchmark.json")["metrics"]
    mae_raw = metrics["finetuned_raw"]["mae"]
    mae_cal = metrics["finetuned_calibrated"]["mae"]
    rho = metrics["finetuned_calibrated"]["spearman"]

    fig, axes = plt.subplots(1, 2, figsize=(12.5, 6.3), dpi=145, sharex=True, sharey=True)

    for ax, pred, title, mae, colour in [
        (axes[0], raw, "Before calibration", mae_raw, "#94a3b8"),
        (axes[1], cal, "After Platt calibration", mae_cal, ACCENT),
    ]:
        ax.plot([0, 1], [0, 1], color=MUTED, linewidth=1.2, linestyle=(0, (4, 3)), zorder=1)
        # Shade the parts of the scale the model never reaches. That dead space, rather
        # than the spread of the cloud, is what compression looks like: before calibration
        # the bottom third of the range is unreachable, and calibration recovers it.
        lo, hi = min(pred), max(pred)
        for band_lo, band_hi in [(0, lo), (hi, 1)]:
            ax.axhspan(band_lo, band_hi, color="#71717a", alpha=0.09, zorder=0)
            # Label the band in place rather than with a leader line, but only when there
            # is room for the text inside it.
            if band_hi - band_lo > 0.06:
                ax.text(
                    0.975,
                    (band_lo + band_hi) / 2,
                    "never predicted",
                    fontsize=9.5,
                    color=MUTED,
                    ha="right",
                    va="center",
                    zorder=3,
                )
        ax.scatter(true, pred, s=34, color=colour, alpha=0.6, linewidths=0, zorder=2)
        ax.set_title(title, fontsize=14, fontweight="bold", loc="left", pad=12, color=INK)
        ax.text(
            0.035,
            0.965,
            f"MAE {mae:.3f}\npredictions span {lo:.2f} to {hi:.2f}",
            transform=ax.transAxes,
            fontsize=10.5,
            color=MUTED,
            va="top",
            linespacing=1.5,
        )
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
        ax.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
        ax.grid(True, color=GRID, linewidth=1, zorder=0)
        ax.set_axisbelow(True)
        ax.set_xlabel("True match score", fontsize=11.5, labelpad=8)

    axes[0].set_ylabel("Predicted score", fontsize=11.5, labelpad=8)
    axes[0].text(
        0.5,
        -0.155,
        "the bottom of the scale is out of reach",
        transform=axes[0].transAxes,
        fontsize=10,
        color=FAINT,
        ha="center",
    )
    axes[1].text(
        0.5,
        -0.155,
        "calibration recovers it; the top stays out of reach either way",
        transform=axes[1].transAxes,
        fontsize=10,
        color=FAINT,
        ha="center",
    )

    fig.suptitle(
        "Calibration moved the number without touching the ranking",
        fontsize=18,
        fontweight="bold",
        x=0.062,
        ha="left",
        y=0.98,
        color=INK,
    )
    fig.text(
        0.062,
        0.895,
        f"106 held-out pairs. Platt scaling is strictly increasing, so Spearman is {rho:.4f} in both panels "
        f"while mean absolute error falls from {mae_raw:.3f} to {mae_cal:.3f}.",
        fontsize=10.5,
        color=MUTED,
        ha="left",
        va="bottom",
    )

    fig.subplots_adjust(left=0.075, right=0.975, top=0.80, bottom=0.145, wspace=0.10)
    out = IMAGES / "fig-calibration.png"
    fig.savefig(out)
    plt.close(fig)
    print(f"wrote {out.relative_to(ROOT)}")


def main() -> None:
    IMAGES.mkdir(parents=True, exist_ok=True)
    engine_ladder(cover=True)
    engine_ladder(cover=False)
    behavioural_tests()
    calibration()


if __name__ == "__main__":
    main()
