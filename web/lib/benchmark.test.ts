import { describe, expect, it } from "vitest";

import {
  BANDS,
  bandFor,
  fmt,
  spearman,
  subsetMetrics,
  toSummary,
  type Benchmark,
  type BenchmarkPair,
} from "@/lib/benchmark";

/**
 * The Spearman implementation is hand-rolled because the page recomputes metrics client-side
 * whenever a filter narrows the visible pairs, and shipping a stats library for one function
 * is not worth the bundle weight.
 *
 * That makes it exactly the kind of code that can be subtly wrong and still look plausible.
 * The expected values below were generated with scipy.stats.spearmanr on the same inputs, so
 * these assertions check against a reference implementation rather than against my own
 * arithmetic. Tie handling is covered specifically: the labels come from a five-band rubric,
 * so exact duplicates are common, and naive ranking would bias rho on real data.
 */
describe("spearman", () => {
  it("returns 1 for a perfectly monotonic increasing relationship", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 10);
  });

  it("returns -1 for a perfectly inverted relationship", () => {
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it("uses average ranks for ties in y (scipy reference: 0.9746794345)", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 20, 40, 50])).toBeCloseTo(0.9746794345, 8);
  });

  it("uses average ranks for ties in x (scipy reference: 0.9746794345)", () => {
    expect(spearman([1, 2, 2, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(0.9746794345, 8);
  });

  it("handles ties on both sides", () => {
    expect(spearman([1, 1, 3, 3, 5], [2, 2, 4, 4, 6])).toBeCloseTo(1, 10);
  });

  it("is invariant to monotone transforms, which is why calibration cannot change it", () => {
    const truth = [0.9, 0.7, 0.5, 0.3, 0.1, 0.85, 0.25];
    const raw = [0.81, 0.74, 0.61, 0.35, 0.19, 0.79, 0.3];
    // A Platt sigmoid is strictly increasing, so ranking must survive it untouched.
    const calibrated = raw.map((v) => 1 / (1 + Math.exp(-(6.45 * v - 3.76))));
    expect(spearman(truth, calibrated)).toBeCloseTo(spearman(truth, raw)!, 12);
  });

  it("returns null when one input is constant, because rho is undefined", () => {
    // This is the `NaN` that notebook 03's DeBERTa row reports. It means the model has no
    // ranking ability at all, which is worse than a low score, not missing data.
    expect(spearman([1, 2, 3, 4, 5], [7, 7, 7, 7, 7])).toBeNull();
  });

  it("returns null rather than a fabricated number for fewer than 3 points", () => {
    expect(spearman([1, 2], [3, 4])).toBeNull();
  });

  it("returns null on mismatched input lengths", () => {
    expect(spearman([1, 2, 3], [1, 2])).toBeNull();
  });
});

const pair = (id: number, truth: number, preds: Record<string, number>): BenchmarkPair => ({
  id,
  resume: "resume text",
  jd: "job description text",
  true: truth,
  matchType: "good",
  industry: "Cybersecurity",
  jdLevel: "mid",
  jdPosition: "Analyst",
  preds,
});

describe("subsetMetrics", () => {
  const pairs = [
    pair(1, 0.9, { model: 0.88, other: 0.5 }),
    pair(2, 0.7, { model: 0.74, other: 0.5 }),
    pair(3, 0.5, { model: 0.61, other: 0.5 }),
    pair(4, 0.3, { model: 0.35, other: 0.5 }),
  ];

  it("computes MAE over the pairs that have a prediction", () => {
    const { mae, n } = subsetMetrics(pairs, "model");
    expect(n).toBe(4);
    // |0.9-0.88| + |0.7-0.74| + |0.5-0.61| + |0.3-0.35| = 0.02+0.04+0.11+0.05 = 0.22
    expect(mae).toBeCloseTo(0.22 / 4, 10);
  });

  it("skips pairs the engine has no prediction for instead of scoring them as zero", () => {
    // A missing prediction is missing data. Treating it as 0 would silently punish an engine
    // for pairs it was never run on, which is how a benchmark quietly becomes a lie.
    const withGap = [...pairs, pair(5, 0.6, { other: 0.5 })];
    expect(subsetMetrics(withGap, "model").n).toBe(4);
  });

  it("returns nulls rather than a number when the subset is too small to support one", () => {
    const { spearman: sp, mae, n } = subsetMetrics(pairs.slice(0, 2), "model");
    expect(sp).toBeNull();
    expect(mae).toBeNull();
    expect(n).toBe(2);
  });

  it("returns n = 0 for an engine that is absent everywhere", () => {
    expect(subsetMetrics(pairs, "missing-engine").n).toBe(0);
  });
});

describe("bandFor", () => {
  it.each([
    [0.95, "Strong match"],
    [0.85, "Strong match"],
    [0.84, "Good match"],
    [0.7, "Good match"],
    [0.69, "Partial match"],
    [0.5, "Partial match"],
    [0.49, "Weak match"],
    [0.3, "Weak match"],
    [0.29, "Not a match"],
    [0, "Not a match"],
  ])("maps %s to %s", (score, label) => {
    expect(bandFor(score).label).toBe(label);
  });

  it("covers the full 0 to 1 range with no gaps", () => {
    for (let s = 0; s <= 1.0001; s += 0.01) {
      expect(bandFor(Math.min(s, 1)).label).toBeTruthy();
    }
  });

  it("declares bands in descending order, which bandFor's first-match lookup relies on", () => {
    const mins = BANDS.map((b) => b.min);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
  });
});

describe("fmt", () => {
  it("renders a readable placeholder for missing values", () => {
    expect(fmt(null)).toBe("n/a");
    expect(fmt(undefined)).toBe("n/a");
    expect(fmt(Number.NaN)).toBe("n/a");
  });

  it("respects the requested precision", () => {
    expect(fmt(0.83456, 3)).toBe("0.835");
    expect(fmt(0.83456, 2)).toBe("0.83");
  });

  it("formats zero as a number rather than treating it as absent", () => {
    expect(fmt(0)).toBe("0.000");
  });
});

describe("toSummary", () => {
  it("drops the pair array so the 650 KB of resume text never reaches the client bundle", () => {
    const bundle = {
      meta: { generated: "2026-07-30", modelId: null, nPairs: 2, nPostings: 1, split: "", notes: [], regenerate: "" },
      engines: [],
      metrics: {},
      pairs: [pair(1, 0.5, {}), pair(2, 0.6, {})],
      audit: null,
      matchTypes: [],
      industries: [],
    } as unknown as Benchmark;

    const summary = toSummary(bundle);
    expect(summary.nPairs).toBe(2);
    expect("pairs" in summary).toBe(false);
  });
});
