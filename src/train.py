"""Reproduce the ResumeAI production model end-to-end.

By default this reproduces the recipe the published checkpoint was trained under. Two
flags switch on changes the evidence in this repository already supports but that the
shipped model predates, `--loss cosent` and `--calibration-split posting-grouped`. Both are
opt-in: a reproduction script that quietly produced a different model from the published
one would recreate the exact defect documented in the README.

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
import importlib.metadata
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


def environment() -> dict:
    """The software stack this run happened under, recorded beside its metrics.

    The study's reproducibility finding is that three runs of one recipe span 0.0174
    aggregate Spearman, attributed to AMP non-determinism. That attribution is only
    checkable if each run says what it ran on. Two runs a year apart under different
    PyTorch builds would otherwise be indistinguishable from two runs of the same one, and
    the finding would quietly become an assumption.
    """
    import platform

    info = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "torch": torch.__version__,
        "cuda_available": bool(torch.cuda.is_available()),
        "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }
    for package in ("sentence-transformers", "transformers", "scikit-learn", "numpy", "scipy"):
        try:
            info[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            info[package] = None
    return info


def posting_grouped_split(external: pd.DataFrame, seed: int):
    """Split the external pairs so no posting contributes to both halves.

    The published run split stratified by match type, which scattered each posting's four
    candidates across both halves and left 47 of the 50 final-test postings also feeding
    the calibrator. Ranking metrics cannot be affected, because calibration is monotone,
    and the measured effect on MAE is 0.0006 under leave-one-posting-out refitting. It is
    still the wrong design, and the README has called it the first change for any re-run
    since before this function existed.

    Postings are shuffled and dealt into the half that is currently smaller, which keeps
    the two halves close in size without letting a posting straddle them. Match-type
    stratification is given up in exchange: with 53 postings there is not enough room to
    balance both, and posting disjointness is the property that was actually costing
    something.
    """
    rng = np.random.default_rng(seed)
    postings = external["jd"].unique()
    rng.shuffle(postings)

    left, right, left_n, right_n = [], [], 0, 0
    for posting in postings:
        size = int((external["jd"] == posting).sum())
        if left_n <= right_n:
            left.append(posting)
            left_n += size
        else:
            right.append(posting)
            right_n += size

    calibration = external[external["jd"].isin(left)].copy()
    test = external[external["jd"].isin(right)].copy()
    assert not set(calibration["jd"]) & set(test["jd"]), "posting leaked across the split"
    return calibration, test


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
    return [float(cosine_similarity([r], [j])[0][0]) for r, j in zip(r_embs, j_embs, strict=False)]


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
    # The two changes the evidence in this repository already supports, off by default so
    # that a bare `python src/train.py` still reproduces the recipe the published
    # checkpoint was trained under. Turning either on produces a different model, and a
    # reproduction script that silently produced a different model would be worse than one
    # that is out of date.
    parser.add_argument("--loss", choices=("combined", "cosent"), default="combined",
                        help="combined reproduces the published model; cosent drops the "
                             "CosineSimilarity term, which Notebooks/07 could not "
                             "distinguish from it (see Results/loss_ablation_significance.json)")
    parser.add_argument("--calibration-split", choices=("stratified", "posting-grouped"),
                        default="stratified",
                        help="stratified reproduces the published split; posting-grouped "
                             "keeps every posting on one side, which the README calls the "
                             "first change for any re-run")
    args = parser.parse_args()

    from sentence_transformers import InputExample, SentenceTransformer, losses
    from sentence_transformers.evaluation import EmbeddingSimilarityEvaluator

    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}" + ("" if device == "cuda" else "  (CPU training works but is slow, consider Colab T4)"))

    # ── Data ──
    for path in (args.train_csv, args.external_csv):
        if not Path(path).exists():
            sys.exit(f"ERROR: {path} not found. Run from the repo root or pass --train-csv/--external-csv.")

    df = pd.read_csv(args.train_csv)
    ext_full = pd.read_csv(args.external_csv)
    for d in (df, ext_full):
        d["jd_clean"] = d["jd"].apply(lambda x: smart_truncate_jd(x, 350))

    if args.calibration_split == "posting-grouped":
        ext_cal, ext_test = posting_grouped_split(ext_full, SEED)
    else:
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
        # Two dataloaders either way. fit() runs one backward pass per objective per step,
        # so a one-objective arm would receive half the gradient updates and the comparison
        # against the published model would confound the loss with the schedule. Notebooks/07
        # matched them for the same reason.
        dl_first = DataLoader(examples, shuffle=True, batch_size=args.batch_size)
        dl_second = DataLoader(examples, shuffle=True, batch_size=args.batch_size)
        evaluator = EmbeddingSimilarityEvaluator(
            sentences1=val_df["resume"].tolist(),
            sentences2=val_df["jd_clean"].tolist(),
            scores=val_df["score"].astype(float).tolist(),
            name="val",
        )
        second_loss = (losses.CoSENTLoss(model=model) if args.loss == "cosent"
                       else losses.CosineSimilarityLoss(model=model))
        model.fit(
            train_objectives=[
                (dl_first, losses.CoSENTLoss(model=model)),
                (dl_second, second_loss),
            ],
            evaluator=evaluator,
            epochs=args.epochs,
            warmup_steps=int(len(dl_first) * 0.1),
            evaluation_steps=len(dl_first),
            output_path=str(model_dir),
            show_progress_bar=True,
            use_amp=(device == "cuda"),
        )
        print(f"Model saved to {model_dir}")

        # Reload the SAVED weights before calibrating or evaluating.
        #
        # SentenceTransformer.fit() defaults to save_best_model=True, so `model_dir`
        # holds the best checkpoint by *validation* score while the in-memory `model`
        # is the final epoch. Those are different weights. Calibrating the in-memory
        # model and then shipping the directory silently mismatches the calibrator to
        # the model and reports metrics for weights nobody can load.
        #
        # Everything below therefore describes exactly what `model_dir` contains,
        # which is what gets published.
        del model
        if device == "cuda":
            torch.cuda.empty_cache()
        model = SentenceTransformer(str(model_dir))

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
        "recipe": {
            "loss": args.loss,
            "calibration_split": args.calibration_split,
            "batch_size": args.batch_size,
            "seed": SEED,
            "reproduces_published_checkpoint":
                args.loss == "combined" and args.calibration_split == "stratified",
        },
        "environment": environment(),
        "results": results,
    }, indent=2), encoding="utf-8")
    print(f"\nCalibrators saved to {out}/ | Metrics: {metrics_path}")

    if args.push_to_hub:
        print(f"\nPushing model to https://huggingface.co/{args.push_to_hub} ...")
        model.push_to_hub(args.push_to_hub, exist_ok=True)
        print("Done. Set MODEL_ID to this repo id in the app / HF Space.")


if __name__ == "__main__":
    main()
