"""Reproduce the ResumeAI production model end-to-end.

Pipeline (mirrors Notebooks/05_production_v2.ipynb):
  1. Load Data/resume_jd_training_800.csv + Data/external_test_200_pairs.csv
  2. Smart-truncate JDs, split external set 106 calibration / 106 final test
  3. Augment training pairs 3x
  4. Fine-tune all-mpnet-base-v2 with combined CoSENT + CosineSimilarity loss
  5. Fit isotonic + Platt calibrators on the external calibration split
  6. Report Spearman / MAE on the untouched 106-pair final test
  7. Save model, calibrators, and Results/training_metrics.json

Runs on CUDA when available (Colab T4: ~1 h) or CPU (overnight).

Usage:
  python src/train.py
  python src/train.py --epochs 4 --batch-size 16
  python src/train.py --push-to-hub USERNAME/resume-jd-matcher-mpnet
  python src/train.py --eval-only            # re-evaluate an existing models/ dir
"""

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from scipy.optimize import minimize
from scipy.stats import spearmanr
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.augment import augment_dataset
from src.text_utils import smart_truncate_jd

SEED = 42
REPO_ROOT = Path(__file__).resolve().parent.parent


class PlattCalibrator:
    """Two-parameter sigmoid calibration: calibrated = sigmoid(a * raw + b).

    Generalizes better than isotonic regression from small calibration sets,
    at the cost of a less flexible mapping.
    """

    def __init__(self):
        self.a, self.b = 1.0, 0.0

    def fit(self, raw_scores, true_scores):
        raw, true = np.asarray(raw_scores), np.asarray(true_scores)

        def loss(params):
            a, b = params
            return float(np.mean((1.0 / (1.0 + np.exp(-(a * raw + b))) - true) ** 2))

        result = minimize(loss, x0=[1.0, 0.0], method="Nelder-Mead")
        self.a, self.b = result.x
        return self

    def __call__(self, scores):
        s = np.asarray(scores)
        return (1.0 / (1.0 + np.exp(-(self.a * s + self.b)))).tolist()


def encode_pairs(model, eval_df):
    r_embs = model.encode(eval_df["resume"].tolist(), show_progress_bar=False, convert_to_numpy=True)
    j_embs = model.encode(eval_df["jd_clean"].tolist(), show_progress_bar=False, convert_to_numpy=True)
    return [float(cosine_similarity([r], [j])[0][0]) for r, j in zip(r_embs, j_embs)]


def metrics(true_scores, predictions):
    spearman, _ = spearmanr(true_scores, predictions)
    mae = float(np.mean(np.abs(np.asarray(true_scores) - np.asarray(predictions))))
    return {"spearman": round(float(spearman), 4), "mae": round(mae, 4)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--train-csv", default=str(REPO_ROOT / "Data" / "resume_jd_training_800.csv"))
    parser.add_argument("--external-csv", default=str(REPO_ROOT / "Data" / "external_test_200_pairs.csv"))
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "models"))
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--push-to-hub", metavar="REPO_ID", help="e.g. dlepighe1/resume-jd-matcher-mpnet")
    parser.add_argument("--eval-only", action="store_true", help="skip training, evaluate model in --output-dir")
    args = parser.parse_args()

    from sentence_transformers import InputExample, SentenceTransformer, losses
    from sentence_transformers.evaluation import EmbeddingSimilarityEvaluator

    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}" + ("" if device == "cuda" else "  (CPU training works but is slow — consider Colab T4)"))

    # ── Data ──
    for path in (args.train_csv, args.external_csv):
        if not Path(path).exists():
            sys.exit(f"ERROR: {path} not found. Run from the repo root or pass --train-csv/--external-csv.")

    df = pd.read_csv(args.train_csv)
    ext_full = pd.read_csv(args.external_csv)
    for d in (df, ext_full):
        d["jd_clean"] = d["jd"].apply(lambda x: smart_truncate_jd(x, 350))

    ext_cal, ext_test = train_test_split(
        ext_full, test_size=0.5, random_state=SEED, stratify=ext_full["match_type"]
    )
    train_df, val_df = train_test_split(df, test_size=0.15, random_state=SEED, stratify=df["match_type"])
    train_df, val_df = train_df.copy(), val_df.copy()

    print(f"Training: {len(train_df)} pairs | Val: {len(val_df)} | "
          f"External: {len(ext_cal)} calibration + {len(ext_test)} final test")

    model_dir = Path(args.output_dir) / "mpnet-resume-matcher"

    if args.eval_only:
        model = SentenceTransformer(str(model_dir))
    else:
        aug_df = augment_dataset(train_df, n_aug=3, seed=SEED)
        print(f"Augmented: {len(train_df)} -> {len(aug_df)} training examples")

        model = SentenceTransformer("all-mpnet-base-v2")
        examples = [
            InputExample(texts=[r["resume"], r["jd"]], label=float(r["score"]))
            for _, r in aug_df.iterrows()
        ]
        # Two objectives share the same data: CoSENT for ranking, Cosine for calibration
        dl_cosent = DataLoader(examples, shuffle=True, batch_size=args.batch_size)
        dl_cosine = DataLoader(examples, shuffle=True, batch_size=args.batch_size)
        evaluator = EmbeddingSimilarityEvaluator(
            sentences1=val_df["resume"].tolist(),
            sentences2=val_df["jd_clean"].tolist(),
            scores=val_df["score"].astype(float).tolist(),
            name="val",
        )
        model.fit(
            train_objectives=[
                (dl_cosent, losses.CoSENTLoss(model=model)),
                (dl_cosine, losses.CosineSimilarityLoss(model=model)),
            ],
            evaluator=evaluator,
            epochs=args.epochs,
            warmup_steps=int(len(dl_cosent) * 0.1),
            evaluation_steps=len(dl_cosent),
            output_path=str(model_dir),
            show_progress_bar=True,
            use_amp=(device == "cuda"),
        )
        print(f"Model saved to {model_dir}")

    # ── Calibration (fitted on external calibration split only) ──
    cal_raw = encode_pairs(model, ext_cal)
    cal_true = ext_cal["score"].astype(float).tolist()

    isotonic = IsotonicRegression(out_of_bounds="clip").fit(cal_raw, cal_true)
    platt = PlattCalibrator().fit(cal_raw, cal_true)

    # ── Final evaluation (untouched 106 pairs) ──
    test_raw = encode_pairs(model, ext_test)
    test_true = ext_test["score"].astype(float).tolist()

    results = {
        "MPNet raw (combined loss)": metrics(test_true, test_raw),
        "MPNet + Platt calibration": metrics(test_true, platt(test_raw)),
        "MPNet + isotonic calibration": metrics(test_true, isotonic.predict(test_raw).tolist()),
    }

    print(f"\n{'Model':<35} {'Spearman':>9} {'MAE':>8}")
    print("-" * 54)
    for name, m in results.items():
        print(f"{name:<35} {m['spearman']:>9.4f} {m['mae']:>8.4f}")

    # ── Persist ──
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "isotonic_calibrator.pkl", "wb") as f:
        pickle.dump(isotonic, f)
    with open(out / "platt_calibrator.pkl", "wb") as f:
        pickle.dump(platt, f)

    metrics_path = REPO_ROOT / "Results" / "training_metrics.json"
    metrics_path.parent.mkdir(exist_ok=True)
    metrics_path.write_text(json.dumps({
        "training_pairs": len(train_df),
        "external_calibration_pairs": len(ext_cal),
        "external_final_test_pairs": len(ext_test),
        "epochs": args.epochs,
        "results": results,
    }, indent=2), encoding="utf-8")
    print(f"\nCalibrators saved to {out}/ | Metrics: {metrics_path}")

    if args.push_to_hub:
        print(f"\nPushing model to https://huggingface.co/{args.push_to_hub} ...")
        model.push_to_hub(args.push_to_hub, exist_ok=True)
        print("Done. Set MODEL_ID to this repo id in the app / HF Space.")


if __name__ == "__main__":
    main()
