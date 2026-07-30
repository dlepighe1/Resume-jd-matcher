"""
Calibrate Claude's raw benchmark scores the way the fine-tuned model is calibrated, fit a
mapping on the CALIBRATION split and apply it to the held-out TEST split, so the comparison
is calibrated-vs-calibrated rather than calibrated-vs-raw. Calibration is monotonic, so it
leaves Spearman (ranking) unchanged and only moves MAE (absolute agreement).

PREREQUISITE, score BOTH splits with claude_benchmark.py first:
    python scripts/claude_benchmark.py --bedrock --region us-east-2 --workers 1 --sleep 5 \
        --split test --model us.anthropic.claude-opus-4-5-20251101-v1:0   # already done
    python scripts/claude_benchmark.py --bedrock --region us-east-2 --workers 1 --sleep 5 \
        --split cal  --model us.anthropic.claude-opus-4-5-20251101-v1:0   # the new run

THEN:
    python scripts/calibrate.py

Requires: pip install scikit-learn scipy numpy
"""

import json
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LinearRegression

REPO = Path(__file__).resolve().parents[1]
RESULTS_DIR = REPO / "results"
CAL_PATH = RESULTS_DIR / "claude_benchmark_cal_predictions.jsonl"
TEST_PATH = RESULTS_DIR / "claude_benchmark_predictions.jsonl"

# Shipped fine-tuned model on the same 106-pair final test (Results/results_summary.json).
FINETUNED = {"spearman": 0.8645, "mae": 0.1021}


def load(path: Path):
    if not path.exists():
        raise SystemExit(
            f"Missing {path.relative_to(REPO)}, run claude_benchmark.py for that split first."
        )
    recs = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    good = [r for r in recs if "claude_pred" in r]  # skip any error rows
    raw = np.array([r["claude_pred"] for r in good], dtype=float)   # Claude 0..1
    label = np.array([r["label"] for r in good], dtype=float)       # ground truth 0..1
    return raw, label


def metrics(pred, true):
    sp, _ = spearmanr(true, pred)
    mae = float(np.mean(np.abs(np.asarray(pred) - np.asarray(true))))
    return round(float(sp), 4), round(mae, 4)


def main() -> None:
    raw_cal, y_cal = load(CAL_PATH)
    raw_test, y_test = load(TEST_PATH)
    print(f"calibration pairs: {len(raw_cal)} | test pairs: {len(raw_test)}")

    raw_sp, raw_mae = metrics(raw_test, y_test)

    # Fit on the calibration split only, evaluate on the untouched test split.
    iso = IsotonicRegression(out_of_bounds="clip").fit(raw_cal, y_cal)
    iso_pred = iso.predict(raw_test)
    iso_sp, iso_mae = metrics(iso_pred, y_test)

    lin = LinearRegression().fit(raw_cal.reshape(-1, 1), y_cal)
    lin_pred = np.clip(lin.predict(raw_test.reshape(-1, 1)), 0.0, 1.0)
    lin_sp, lin_mae = metrics(lin_pred, y_test)

    summary = {
        "model": "us.anthropic.claude-opus-4-5-20251101-v1:0 (Bedrock)",
        "test_pairs": len(raw_test),
        "claude_raw": {"spearman": raw_sp, "mae": raw_mae},
        "claude_linear_calibrated": {"spearman": lin_sp, "mae": lin_mae},
        "claude_isotonic_calibrated": {"spearman": iso_sp, "mae": iso_mae},
        "finetuned_mpnet": FINETUNED,
        "note": "Calibrator fit on the 106 calibration pairs, applied to the 106 held-out test "
                "pairs, same protocol as the fine-tuned model. Monotonic, so Spearman is "
                "unchanged; only MAE moves.",
    }
    out = RESULTS_DIR / "claude_benchmark_calibrated.json"
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n" + "=" * 64)
    print("Claude Opus 4.5 (via Bedrock) on the 106-pair test set")
    print("=" * 64)
    print(f"  raw                        Spearman={raw_sp:.4f}  MAE={raw_mae:.4f}")
    print(f"  + linear calibration       Spearman={lin_sp:.4f}  MAE={lin_mae:.4f}")
    print(f"  + isotonic calibration     Spearman={iso_sp:.4f}  MAE={iso_mae:.4f}")
    print(f"  Fine-tuned MPNet (shipped) Spearman={FINETUNED['spearman']:.4f}  MAE={FINETUNED['mae']:.4f}")
    print(f"\nSaved: {out.relative_to(REPO)}")


if __name__ == "__main__":
    main()
