# Efficiency study: design

**Status:** designed and scaffolded, not yet run. `scripts/benchmark_inference.py` implements
the PyTorch arms; the ONNX arms need two dependencies that are not installed by default.

## Why this study exists

Every other question in this repository is about whether the model is *right*. None is about
whether it is *affordable*, and that gap is visible: the shipped service loads 420 MB of
weights onto a scale-to-zero CPU container, cold starts take 30 to 60 seconds, and the one
upgrade the ablation surfaced was rejected on serving cost alone with no measurement behind
the rejection.

The three-seed ensemble question is the clearest case. `Notebooks/07` found it reached 0.8639
against the shipped 0.8163, and the README declined it because it "triples serving cost". That
is a plausible sentence and it is not a number. This study makes it one.

There is also an honest portfolio reason, stated plainly because it drove the priority: the
project currently demonstrates evaluation judgement and does not demonstrate that its author
can reason about inference cost. Those are different skills and only one of them is evidenced
so far.

## The question

For each way of serving this model, what does it cost in latency, throughput, memory and disk,
and what does it cost in accuracy?

## Decision rule, fixed in advance

A configuration is **adoptable** when its Spearman on the 106-pair final test sits within the
project's existing equivalence margin of the fp32 reference, and its p95 latency is lower.

The margin is 0.0174, the same one `scripts/significance.py` derives from the gap between two
runs of the identical training recipe. Reusing it matters: a quantisation that moves the score
less than re-running the training would is not a degradation the project can even detect, so
calling it one would be inconsistent with every other conclusion here.

Writing the rule down before running is the same discipline `Notebooks/07` used. Without it,
a table of latencies invites picking whichever row looks best afterwards.

## Arms

| Arm | Available now | Notes |
|---|---|---|
| PyTorch fp32 | Yes | The reference. Everything is measured against it |
| PyTorch int8, dynamic quantisation | Yes | `torch.ao.quantization.quantize_dynamic` over the Linear layers. No calibration data needed, which is why it goes first |
| ONNX Runtime fp32 | Needs `onnxruntime`, `onnx`, `optimum` | Graph-level fusion, usually the largest single CPU win |
| ONNX Runtime int8 | Same | Dynamic quantisation applied post-export |
| 3-seed ensemble, fp32 | Needs the two extra checkpoints | Settles the open question from `Notebooks/07` with a cost figure instead of an adjective |

Install for the ONNX arms:

```bash
pip install onnxruntime==1.20.1 onnx==1.17.0 optimum==1.24.0
```

Pinned rather than ranged, for the reason `requirements.txt` explains. They are deliberately
not in the default install: they are 200 MB of dependency that nothing else in this repository
needs, and the scoring service does not use them.

## Measurements

**Latency.** p50 and p95 over repeated single-pair scores, after discarded warmup iterations.
p95 rather than mean, because a user waiting on a page experiences the tail. Warmup is not
optional on CPU: the first call through a fresh graph is unrepresentative by a wide margin.

**Throughput.** Pairs per second at batch sizes 1, 8 and 32. Batch 1 is the interactive path
the product actually uses; the larger sizes say what headroom exists if scoring were ever
queued.

**Memory.** Peak resident set size during a scoring run, sampled from `psutil`, plus model
size on disk. Disk matters more than it looks: it is most of the cold-start time on a
scale-to-zero host.

**Accuracy.** Spearman and MAE on the same 106-pair final test everything else here reports,
plus the maximum absolute deviation from the fp32 reference score per pair. The aggregate can
hide a configuration that leaves the ranking intact while moving individual scores enough to
cross a verdict band, which is what a user would actually notice.

## Threats to validity, and what the harness does about them

- **Thermal and background noise on a laptop.** Interleave the arms rather than running each
  to completion in turn, and report the median of repeated blocks. A clean sweep of arm A
  followed by arm B measures the machine's temperature as much as the arms.
- **Thread count.** Fix `torch.set_num_threads` explicitly and record it. The default varies
  by machine and silently changes every number.
- **Quantisation is data-dependent.** Dynamic quantisation calibrates per batch, so accuracy
  can move with batch composition. Score the final test in a fixed order and record it.
- **One machine is one machine.** Absolute latencies do not transfer. Ratios against the fp32
  reference on the same hardware are the reportable quantity, and the host is recorded
  alongside the results.

## What gets written

`Results/inference_benchmark.json`, with the configuration matrix, the environment block
`src/train.py` already records for training runs, and an `adoptable` flag per arm from the
decision rule above. A README section reports it, and a test asserts that any arm the README
recommends is one the artifact marks adoptable.

## What would make this a real contribution rather than a table

The interesting result is not "int8 is faster". It is the shape of the accuracy-cost frontier
at this model size and this task, and specifically whether the ensemble question has an answer
that depends on the deployment target. A 3x cost that buys 0.05 Spearman is an easy no on a
sleeping free-tier container and a plausible yes on an always-on host. Reporting the trade-off
as a curve with the decision rule applied, rather than as a recommendation, is what would make
it worth reading.
