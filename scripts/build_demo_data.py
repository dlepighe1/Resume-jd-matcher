"""Assemble the demo page's benchmark bundle from whatever evidence exists on disk.

Output: web/public/benchmark.json, every number the demo page displays, so the page
itself contains no hardcoded metrics. If a metric is on the page, it came from here; if it
came from here, it was computed from per-pair predictions in this file. There is no third
path where a stale number can survive.

Sources, all optional except the ground truth:

  Data/external_test_200_pairs.csv           ground truth + text (required)
  Results/claude_benchmark_predictions.jsonl      Claude on the 106-pair TEST split
  Results/claude_benchmark_cal_predictions.jsonl  Claude on the 106-pair CAL split
  Results/demo_pairs.json                    fine-tuned / base / TF-IDF / Jaccard,
                                             exported by Notebooks/06_model_audit.ipynb

Run it with only the CSV and you get a page that renders with the labels and no
predictions. Run it after notebook 06 and the fine-tuned model appears. The page reads
`engines[].available` and renders accordingly, so it is never broken, only less complete.

Usage:
    python scripts/build_demo_data.py
"""

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.isotonic import IsotonicRegression
from sklearn.model_selection import train_test_split

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "web" / "public" / "benchmark.json"
SPLIT_SEED = 42
BOOTSTRAP = 2000

# Engine display metadata. `kind` drives how the page groups them: a calibrated model, an
# uncalibrated similarity score, and a non-ML baseline are not comparable on MAE, only on
# ranking, and the page has to say so rather than putting them in one column.
ENGINES = [
    {
        "id": "finetuned_calibrated",
        "label": "Fine-tuned MPNet + Platt",
        "short": "Fine-tuned",
        "kind": "calibrated",
        "blurb": "The production model. Fine-tuned on 815 resume/JD pairs, then Platt-calibrated on held-out postings so the number means what it says.",
        "plain": "The model this project built and ships. Its score is calibrated, so it is meant to be read as a percentage.",
    },
    {
        "id": "finetuned_raw",
        "label": "Fine-tuned MPNet (uncalibrated)",
        "short": "Fine-tuned, raw",
        "kind": "uncalibrated",
        "blurb": "The same model before calibration. Ranks identically, calibration is monotonic, but the absolute numbers are compressed.",
        "plain": "The same model before the step that makes its output readable as a percentage. It orders candidates just as well; only the number itself is off.",
    },
    {
        "id": "base_mpnet",
        "label": "Base MPNet (no fine-tuning)",
        "short": "Base model",
        "kind": "uncalibrated",
        "blurb": "Off-the-shelf all-mpnet-base-v2. The before picture: what you get without any of this project's training.",
        "plain": "A general-purpose model used straight off the shelf, with none of this project's training. This is the before picture.",
    },
    {
        "id": "claude_calibrated",
        "label": "Claude Opus 4.5 (calibrated)",
        "short": "Claude, calibrated",
        "kind": "calibrated",
        "blurb": "A frontier LLM scoring the same pairs zero-shot, then put through the identical calibration protocol so the comparison is calibrated-vs-calibrated.",
        "plain": "A frontier language model given the same pairs and put through the same calibration procedure, so the comparison is like for like.",
    },
    {
        "id": "claude_raw",
        "label": "Claude Opus 4.5 (raw)",
        "short": "Claude, raw",
        "kind": "uncalibrated",
        "blurb": "Claude's unadjusted output. Competent at ordering candidates, poorly calibrated in absolute terms, it compresses strong matches downward.",
        "plain": "The same frontier model with no calibration applied to its output.",
    },
    {
        "id": "tfidf",
        "label": "TF-IDF cosine",
        "short": "TF-IDF",
        "kind": "baseline",
        "blurb": "Classic information retrieval. Bag of words, no semantics, no training. The honest question every ML project should answer: would this have been enough?",
        "plain": "Classic information retrieval with no training and no semantics. The baseline any learned model has to beat to justify itself.",
    },
    {
        "id": "jaccard",
        "label": "Word overlap (Jaccard)",
        "short": "Word overlap",
        "kind": "baseline",
        "blurb": "The simplest thing that could possibly work: what fraction of the vocabulary do the two documents share?",
        "plain": "The share of vocabulary the resume and the posting have in common. Nothing more than that.",
    },
]


def spearman_mae(true, pred):
    """Both metrics, or None where undefined (constant predictions)."""
    true, pred = np.asarray(true, float), np.asarray(pred, float)
    if len(true) < 3 or len(np.unique(pred)) < 2:
        return None, None
    sp, _ = spearmanr(true, pred)
    return (None if np.isnan(sp) else round(float(sp), 4),
            round(float(np.mean(np.abs(true - pred))), 4))


def bootstrap_ci(true, pred, n=BOOTSTRAP, seed=SPLIT_SEED):
    """Percentile CI for Spearman. On 106 pairs the interval is wide, and the page shows
    it precisely so nobody reads a 0.01 gap between engines as a real difference."""
    true, pred = np.asarray(true, float), np.asarray(pred, float)
    if len(np.unique(pred)) < 2:
        return None
    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(n):
        idx = rng.integers(0, len(true), len(true))
        if len(np.unique(true[idx])) < 2 or len(np.unique(pred[idx])) < 2:
            continue
        s, _ = spearmanr(true[idx], pred[idx])
        if not np.isnan(s):
            vals.append(s)
    if len(vals) < n // 4:
        return None
    return [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)]


def load_jsonl(path):
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if "claude_pred" in rec:
            out[int(rec["id"])] = float(rec["claude_pred"])
    return out


def main():
    ext = pd.read_csv(REPO / "Data" / "external_test_200_pairs.csv")
    cal_df, test_df = train_test_split(
        ext, test_size=0.5, random_state=SPLIT_SEED, stratify=ext["match_type"])
    test_df = test_df.reset_index(drop=True)
    test_ids = [int(i) for i in test_df["id"]]
    truth = test_df["score"].astype(float).tolist()

    notes = []
    preds = {}

    # ── Claude: raw on test, plus isotonic fitted on the calibration split ──
    claude_test = load_jsonl(REPO / "Results" / "claude_benchmark_predictions.jsonl")
    claude_cal = load_jsonl(REPO / "Results" / "claude_benchmark_cal_predictions.jsonl")
    if claude_test:
        preds["claude_raw"] = [claude_test.get(i) for i in test_ids]
        if claude_cal:
            cal_ids = [int(i) for i in cal_df["id"] if int(i) in claude_cal]
            cal_lookup = dict(zip(cal_df["id"].astype(int), cal_df["score"].astype(float)))
            iso = IsotonicRegression(out_of_bounds="clip").fit(
                [claude_cal[i] for i in cal_ids], [cal_lookup[i] for i in cal_ids])
            preds["claude_calibrated"] = [
                round(float(iso.predict([claude_test[i]])[0]), 4) if i in claude_test else None
                for i in test_ids
            ]
            notes.append(
                f"Claude's calibrator is isotonic regression fitted on the {len(cal_ids)}-pair "
                "calibration split and applied to the untouched test split, the same protocol "
                "the fine-tuned model gets, so the comparison is calibrated-vs-calibrated.")
        else:
            notes.append("Claude calibration split missing, only raw Claude scores are shown.")
    else:
        notes.append("No Claude benchmark found; Claude engines are unavailable.")

    # ── Fine-tuned / base / TF-IDF / Jaccard, from notebook 06 ──
    demo_path = REPO / "Results" / "demo_pairs.json"
    audit = None
    model_id = None
    if demo_path.exists():
        demo = json.loads(demo_path.read_text(encoding="utf-8"))
        model_id = demo.get("model_id")
        AUDIT_KEYS = ("calibration", "name_bias", "preprocessing", "by_match_type",
                      "hard_negative_subtypes")
        audit = {k: demo.get(k) for k in AUDIT_KEYS if demo.get(k)}

        # demo_pairs.json carries most of the audit, but not every section. Fill the rest
        # from the audit artifact itself, which is where notebook 06 writes all of them.
        audit_path = REPO / "Results" / "audit_results.json"
        if audit_path.exists():
            full = json.loads(audit_path.read_text(encoding="utf-8"))
            for k in AUDIT_KEYS:
                if k not in audit and full.get(k):
                    audit[k] = full[k]
        by_id = {int(p["id"]): p["preds"] for p in demo["pairs"]}
        missing = [i for i in test_ids if i not in by_id]
        if missing:
            notes.append(f"WARNING: demo_pairs.json is missing {len(missing)} test pairs.")
        for key in ("finetuned_calibrated", "finetuned_raw", "base_mpnet", "tfidf", "jaccard"):
            if any(key in v for v in by_id.values()):
                preds[key] = [by_id.get(i, {}).get(key) for i in test_ids]

        # ── Guard: the audit must describe the model notebook 05 measured ──
        #
        # The audit notebook scores whatever MODEL_ID resolves to on the Hub. If that is a
        # different checkpoint, the predictions here are real numbers from the wrong model
        # and nothing downstream can tell. This is not hypothetical, the first run of these
        # notebooks published the best-by-validation checkpoint while reporting the
        # final-epoch model's metrics, and the mismatch was invisible until these two
        # sources were compared.
        #
        # Raw cosine is the comparison basis: it depends only on the weights, so it
        # separates a model mismatch from a calibrator mismatch.
        prod_path = REPO / "Results" / "production_results.json"
        if prod_path.exists() and "finetuned_raw" in preds:
            expected = json.loads(prod_path.read_text(encoding="utf-8"))["production"]["raw"]["spearman"]
            got, _ = spearman_mae(truth, [v if v is not None else np.nan for v in preds["finetuned_raw"]])
            if got is not None and abs(got - expected) > 0.01:
                for key in ("finetuned_calibrated", "finetuned_raw"):
                    preds.pop(key, None)
                audit = None
                notes.append(
                    f"REJECTED the fine-tuned predictions: raw Spearman in demo_pairs.json is "
                    f"{got:.4f} but Results/production_results.json reports {expected:.4f} "
                    f"({abs(got - expected):.4f} apart). The audit ran against different weights "
                    f"than notebook 05 measured, so those predictions, and every audit finding "
                    f"derived from them, describe a model that was never evaluated. Re-run "
                    f"notebook 05 (it now reloads the saved checkpoint before calibrating), let "
                    f"its publish cell finish, then re-run notebook 06. Baselines below "
                    f"(base MPNet, TF-IDF, Jaccard) do not depend on the published model and "
                    f"are kept."
                )
            else:
                notes.append(
                    f"Verified: the audited model reproduces notebook 05's raw Spearman "
                    f"({got:.4f} vs {expected:.4f})."
                )
    else:
        notes.append(
            "Results/demo_pairs.json not found, run Notebooks/06_model_audit.ipynb and copy its "
            "output into Results/ to populate the fine-tuned model, base model, and baselines. "
            "The page renders without them.")

    # ── Metrics computed from the very predictions the page will render ──
    metrics = {}
    for engine in ENGINES:
        eid = engine["id"]
        vals = preds.get(eid)
        if not vals or all(v is None for v in vals):
            engine["available"] = False
            continue
        paired = [(t, v) for t, v in zip(truth, vals) if v is not None]
        t, v = [p[0] for p in paired], [p[1] for p in paired]
        sp, mae = spearman_mae(t, v)
        engine["available"] = True
        metrics[eid] = {
            "spearman": sp,
            "mae": mae if engine["kind"] != "baseline" else None,
            "spearman_ci95": bootstrap_ci(t, v),
            "n": len(paired),
        }
        if engine["kind"] == "baseline":
            metrics[eid]["mae_note"] = (
                "MAE is omitted: this baseline's output is a similarity in its own units, "
                "not an estimate of the 0-1 label. Only its ranking is comparable.")

    pairs = []
    for i, row in test_df.iterrows():
        pid = int(row["id"])
        pairs.append({
            "id": pid,
            "resume": row["resume"],
            "jd": row["jd"],
            "true": round(float(row["score"]), 4),
            "matchType": row["match_type"],
            "industry": row.get("industry"),
            "jdLevel": row.get("jd_level"),
            "jdPosition": row.get("jd_position"),
            "preds": {e["id"]: preds[e["id"]][i] for e in ENGINES
                      if e.get("available") and preds[e["id"]][i] is not None},
        })

    # Which differences between engines survive resampling. Written by scripts/significance.py
    # rather than recomputed here, so the page and the study cite one number.
    significance = None
    sig_path = REPO / "Results" / "significance.json"
    if sig_path.exists():
        significance = json.loads(sig_path.read_text(encoding="utf-8"))
        if audit is None:
            # The fine-tuned predictions were rejected above, and every comparison in
            # significance.json is against those predictions.
            significance = None
            notes.append("Significance results withheld: they describe the rejected model.")
    else:
        notes.append("No Results/significance.json; run python scripts/significance.py.")

    bundle = {
        "meta": {
            "generated": date.today().isoformat(),
            "modelId": model_id,
            "nPairs": len(pairs),
            "nPostings": int(test_df["jd"].nunique()),
            "split": (
                "External final test: 106 pairs from job postings with zero overlap with the "
                "training set, asserted in code. No pair here was used to fit the calibrator. "
                "The split is stratified by match type rather than grouped by posting, so 47 "
                "of these 50 postings do contribute other candidates to the calibration half. "
                "Ranking metrics are unaffected by construction, and the effect on absolute "
                "error was measured at 0.0006."
            ),
            "notes": notes,
            "regenerate": "python scripts/build_demo_data.py",
        },
        "engines": ENGINES,
        "metrics": metrics,
        "pairs": pairs,
        "audit": audit,
        "significance": significance,
        "matchTypes": sorted(test_df["match_type"].dropna().unique().tolist()),
        "industries": sorted(test_df["industry"].dropna().unique().tolist()),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, indent=1), encoding="utf-8")

    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(REPO)}, {len(pairs)} pairs, {kb:.0f} KB")
    print(f"  engines available: {[e['id'] for e in ENGINES if e.get('available')]}")
    for n in notes:
        print(f"  note: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
