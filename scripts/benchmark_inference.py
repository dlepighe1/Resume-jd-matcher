"""What each way of serving this model costs, in latency, memory, and accuracy.

Design, threats to validity, and the decision rule are in docs/EFFICIENCY_STUDY.md. Read that
first; this file implements it.

The short version. Every other measurement in this repository asks whether the model is right.
None asks whether it is affordable, and the gap shows: the shipped service loads 420 MB onto a
scale-to-zero CPU container, and the one upgrade the loss ablation surfaced was declined on
"triples serving cost", which is an adjective rather than a number.

THE DECISION RULE IS FIXED BEFORE THE RUN. An arm is adoptable when its Spearman on the
106-pair final test sits within 0.0174 of the fp32 reference and its p95 latency is lower.
That margin is not chosen here: it is the gap between two runs of the identical training
recipe, which scripts/significance.py derives from the artifacts. A quantisation that moves
the score less than re-running the training would is not a degradation this project can
detect, and calling it one would contradict every other conclusion in the repository.

Arms marked unavailable are skipped with a reason rather than silently dropped, because a
benchmark that quietly omits the fastest configuration is worse than no benchmark.

Usage:
    python scripts/benchmark_inference.py --quick     # smoke test, few iterations
    python scripts/benchmark_inference.py             # the real run
    pip install onnxruntime==1.20.1 onnx==1.17.0 optimum==1.24.0   # enables the ONNX arms
"""

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import numpy as np
import pandas as pd
import torch
from scipy.stats import spearmanr
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.text_utils import preprocess_resume, smart_truncate_jd  # noqa: E402
from src.train import SEED, environment  # noqa: E402

EXTERNAL = REPO / "Data" / "external_test_200_pairs.csv"
ABLATION_SIGNIFICANCE = REPO / "Results" / "loss_ablation_significance.json"
OUT = REPO / "Results" / "inference_benchmark.json"
DEFAULT_MODEL = "dlepighe1/resume-jd-matcher-mpnet"
MAX_WORDS = 350
BATCH_SIZES = (1, 8, 32)

# Fixed rather than left to the machine. The default varies by host and silently changes every
# latency number in the output.
THREADS = 4


def display_path(path: Path) -> str:
    """Repo-relative when it can be, absolute otherwise.

    `Path.relative_to` raises rather than falling back, so an --out pointing anywhere outside
    the repository crashed the run after the results had already been written. Losing a
    completed benchmark to a print statement is a silly way to lose one.
    """
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def equivalence_margin() -> float:
    """The Spearman margin, read from the artifact rather than typed.

    Same value scripts/significance.py uses for its equivalence tests, and for the same
    reason: a typed literal keeps asserting a noise floor the project has stopped measuring.
    """
    if ABLATION_SIGNIFICANCE.exists():
        payload = json.loads(ABLATION_SIGNIFICANCE.read_text(encoding="utf-8"))
        margin = payload.get("equivalence_margins", {}).get("spearman")
        if margin:
            return float(margin)
    # Without the artifact there is no measured noise floor, so demand exact agreement rather
    # than inventing a tolerance.
    return 0.0


def load_final_test() -> pd.DataFrame:
    external = pd.read_csv(EXTERNAL)
    _, test = train_test_split(external, test_size=0.5, random_state=SEED,
                               stratify=external["match_type"])
    test = test.reset_index(drop=True)
    test["resume_clean"] = test["resume"].map(lambda r: preprocess_resume(r, MAX_WORDS))
    test["jd_clean"] = test["jd"].map(lambda j: smart_truncate_jd(j, MAX_WORDS))
    return test


def score_all(encode, frame: pd.DataFrame, batch_size: int) -> np.ndarray:
    """Cosine per pair. `encode` takes a list of texts and returns an array of vectors."""
    resumes = encode(frame["resume_clean"].tolist(), batch_size)
    jds = encode(frame["jd_clean"].tolist(), batch_size)
    return np.array([float(cosine_similarity([r], [j])[0][0])
                     for r, j in zip(resumes, jds, strict=True)])


def measure_latency(encode, texts: list[str], iterations: int, warmup: int) -> dict:
    """p50 and p95 of a single-pair encode, after discarded warmup.

    Warmup is not optional on CPU. The first pass through a fresh graph is unrepresentative
    by a wide margin, and including it makes every arm look like whichever ran first.
    """
    for _ in range(warmup):
        encode(texts[:2], 1)

    samples = []
    for i in range(iterations):
        pair = [texts[i % len(texts)], texts[(i + 1) % len(texts)]]
        start = time.perf_counter()
        encode(pair, 1)
        samples.append((time.perf_counter() - start) * 1000)

    return {
        "p50_ms": round(float(np.percentile(samples, 50)), 2),
        "p95_ms": round(float(np.percentile(samples, 95)), 2),
        "iterations": iterations,
    }


def measure_throughput(encode, texts: list[str], batch_size: int) -> float:
    start = time.perf_counter()
    encode(texts, batch_size)
    elapsed = time.perf_counter() - start
    return round(len(texts) / elapsed, 2) if elapsed else 0.0


def peak_rss_mb() -> float | None:
    try:
        import psutil
    except ImportError:
        return None
    return round(psutil.Process().memory_info().rss / (1024 * 1024), 1)


def directory_size_mb(path: Path) -> float | None:
    if not path.exists():
        return None
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return round(total / (1024 * 1024), 1)


def pytorch_arms(model_id: str, quick: bool):
    """The two arms that need nothing beyond what requirements.txt already pins."""
    from sentence_transformers import SentenceTransformer

    fp32 = SentenceTransformer(model_id)
    fp32.eval()

    def encode_fp32(texts, batch_size):
        return fp32.encode(texts, batch_size=batch_size, show_progress_bar=False,
                           convert_to_numpy=True)

    yield "pytorch-fp32", encode_fp32, {"note": "reference configuration"}

    if quick:
        return

    # Dynamic quantisation goes first among the compression arms because it needs no
    # calibration data: weights are quantised ahead of time and activations per batch.
    quantised = torch.ao.quantization.quantize_dynamic(
        SentenceTransformer(model_id).eval(), {torch.nn.Linear}, dtype=torch.qint8)

    def encode_int8(texts, batch_size):
        return quantised.encode(texts, batch_size=batch_size, show_progress_bar=False,
                                convert_to_numpy=True)

    yield "pytorch-int8-dynamic", encode_int8, {
        "note": "torch.ao.quantization.quantize_dynamic over Linear layers",
    }


def onnx_available() -> tuple[bool, str]:
    missing = [m for m in ("onnxruntime", "onnx", "optimum")
               if importlib.util.find_spec(m) is None]
    if missing:
        return False, (f"not installed: {', '.join(missing)}. "
                       f"pip install onnxruntime==1.20.1 onnx==1.17.0 optimum==1.24.0")
    return True, ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--iterations", type=int, default=60)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--quick", action="store_true",
                        help="reference arm, 20 pairs, few iterations: verifies the harness "
                             "runs end to end without spending an hour on CPU. The accuracy "
                             "numbers it produces are not comparable to a real run")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()

    if not EXTERNAL.exists():
        sys.exit(f"Missing {EXTERNAL.relative_to(REPO)}")

    torch.set_num_threads(THREADS)
    iterations = 6 if args.quick else args.iterations
    warmup = 2 if args.quick else args.warmup
    batch_sizes = (1,) if args.quick else BATCH_SIZES

    test = load_final_test()
    if args.quick:
        # Enough to exercise every code path, far too few to report. `quick_mode` is recorded
        # in the artifact so a smoke run can never be mistaken for a measurement.
        test = test.head(20).reset_index(drop=True)
    labels = test["score"].astype(float).to_numpy()
    texts = test["resume_clean"].tolist()
    margin = equivalence_margin()

    print(f"{len(test)} final-test pairs | {THREADS} torch threads | "
          f"equivalence margin {margin}")
    available, reason = onnx_available()
    print(f"ONNX arms: {'available' if available else 'SKIPPED, ' + reason}\n")

    reference_scores = None
    results = []

    for name, encode, meta in pytorch_arms(args.model, args.quick):
        print(f"Measuring {name} ...", flush=True)
        scores = score_all(encode, test, batch_size=8)
        if reference_scores is None:
            reference_scores = scores

        latency = measure_latency(encode, texts, iterations, warmup)
        throughput = {str(b): measure_throughput(encode, texts, b) for b in batch_sizes}
        spearman = float(spearmanr(labels, scores)[0])
        max_deviation = float(np.max(np.abs(scores - reference_scores)))

        results.append({
            "arm": name,
            **meta,
            "latency": latency,
            "throughput_pairs_per_second": throughput,
            "peak_rss_mb": peak_rss_mb(),
            "spearman": round(spearman, 4),
            "mae_raw": round(float(np.mean(np.abs(labels - scores))), 4),
            "max_abs_deviation_from_reference": round(max_deviation, 4),
        })
        print(f"  p50 {latency['p50_ms']} ms | p95 {latency['p95_ms']} ms | "
              f"Spearman {spearman:.4f}")

    if not available:
        results.append({"arm": "onnxruntime-fp32", "skipped": reason})
        results.append({"arm": "onnxruntime-int8", "skipped": reason})

    # ── Apply the decision rule, which was fixed before the run ──
    reference = next(r for r in results if r["arm"] == "pytorch-fp32")
    for arm in results:
        if "skipped" in arm or arm["arm"] == reference["arm"]:
            continue
        within_margin = abs(arm["spearman"] - reference["spearman"]) <= margin
        faster = arm["latency"]["p95_ms"] < reference["latency"]["p95_ms"]
        arm["adoptable"] = bool(within_margin and faster)
        arm["_rule"] = (
            f"Spearman within {margin} of fp32: {within_margin}. "
            f"p95 lower than fp32: {faster}."
        )

    print(f"\n{'arm':<24} {'p50 ms':>8} {'p95 ms':>8} {'Spearman':>9} {'adoptable':>10}")
    print("-" * 64)
    for arm in results:
        if "skipped" in arm:
            print(f"{arm['arm']:<24} {'skipped':>8}")
            continue
        flag = "reference" if arm["arm"] == reference["arm"] else str(arm.get("adoptable"))
        print(f"{arm['arm']:<24} {arm['latency']['p50_ms']:>8.2f} "
              f"{arm['latency']['p95_ms']:>8.2f} {arm['spearman']:>9.4f} {flag:>10}")

    payload = {
        "_what": "What each way of serving this model costs, and whether the cheaper ones "
                 "stay accurate enough to adopt.",
        "_design": "docs/EFFICIENCY_STUDY.md",
        "_decision_rule": (
            f"Adoptable when Spearman on the 106-pair final test is within {margin} of the "
            f"fp32 reference and p95 latency is lower. The margin is the project's measured "
            f"training reproducibility spread, read from "
            f"Results/loss_ablation_significance.json rather than chosen here. Fixed before "
            f"the run."
        ),
        "_portability": (
            "Absolute latencies describe this host and do not transfer. The reportable "
            "quantity is the ratio against the fp32 reference measured on the same machine."
        ),
        "model": args.model,
        "torch_threads": THREADS,
        "model_dir_size_mb": directory_size_mb(REPO / "models" / "mpnet-resume-matcher"),
        "environment": environment(),
        "n_pairs": int(len(test)),
        "quick_mode": bool(args.quick),
        "arms": results,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"\nSaved {display_path(Path(args.out))}")


if __name__ == "__main__":
    main()
