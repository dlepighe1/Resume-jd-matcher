/**
 * The benchmark bundle produced by `scripts/build_demo_data.py`.
 *
 * Every metric the page displays comes from here, and everything here was computed from
 * the per-pair predictions in the same file. There is no third path, no constant in a
 * component and no number typed into JSX, so a metric on the page cannot drift from the
 * evaluation that produced it.
 *
 * The file is ~650 KB because it carries the full resume and JD text for all 106 held-out
 * pairs. That is deliberate: a benchmark you cannot read the inputs of is a benchmark you
 * have to take on faith. It is served as a static asset and fetched only when a visitor
 * opens the pair explorer, so it never lands in the initial bundle.
 */

export type EngineKind = "calibrated" | "uncalibrated" | "baseline";

export interface Engine {
  id: string;
  label: string;
  short: string;
  kind: EngineKind;
  /** Technical framing. */
  blurb: string;
  /** Same idea, no jargon. */
  plain: string;
  available: boolean;
}

export interface EngineMetrics {
  spearman: number | null;
  mae: number | null;
  spearman_ci95: [number, number] | null;
  n: number;
  mae_note?: string;
}

export interface BenchmarkPair {
  id: number;
  resume: string;
  jd: string;
  true: number;
  matchType: string;
  industry: string | null;
  jdLevel: string | null;
  jdPosition: string | null;
  preds: Record<string, number>;
}

/** One engine-vs-engine comparison from the paired cluster bootstrap. */
export interface Comparison {
  metric: "spearman" | "mae";
  a: string;
  b: string;
  a_value: number;
  b_value: number;
  difference: number;
  ci95: [number, number];
  p_value: number;
  significant: boolean;
}

export interface Significance {
  n_pairs: number;
  n_postings: number;
  resamples: number;
  comparisons: Comparison[];
  precision_at_1: {
    hits: number;
    postings: number;
    precision_at_1: number;
    wilson_ci95: [number, number];
    random_baseline: number;
    exact_binomial_p_vs_baseline: number;
  };
  grouped_calibration_check: {
    reported_mae?: number;
    leave_one_posting_out_mae?: number;
    difference?: number;
    skipped?: string;
  };
}

export interface Benchmark {
  meta: {
    generated: string;
    modelId: string | null;
    nPairs: number;
    nPostings: number;
    split: string;
    notes: string[];
    regenerate: string;
  };
  engines: Engine[];
  metrics: Record<string, EngineMetrics>;
  pairs: BenchmarkPair[];
  audit: {
    calibration?: { ece: number; pred_range: number[]; true_range: number[] };
    name_bias?: {
      group_mean_spread: number;
      verdict_flips: number;
      n_pairs: number;
      max_abs_shift?: number;
      largest_gap?: { high: string; low: string; wilcoxon_p: number };
      groups: Record<string, { mean_score: number; delta_vs_overall: number }>;
    };
    preprocessing?: Record<string, { spearman: number; mae: number }>;
    by_match_type?: Record<string, { mae: number; bias: number; n: number }>;
    hard_negative_subtypes?: Record<string, { mae: number; n: number }>;
  } | null;
  significance: Significance | null;
  matchTypes: string[];
  industries: string[];
}

/** Everything the page needs above the fold, i.e. without the 650 KB of pair text. */
export type BenchmarkSummary = Omit<Benchmark, "pairs"> & { nPairs: number };

export function toSummary(b: Benchmark): BenchmarkSummary {
  const { pairs, ...rest } = b;
  return { ...rest, nPairs: pairs.length };
}

/** The five verdict bands the score is read through. Shared by the live scorer and the
 *  benchmark so a 0.62 is never called "partial" in one place and "good" in another. */
export const BANDS = [
  { min: 0.85, label: "Strong match", plain: "Meets essentially every stated requirement" },
  { min: 0.7, label: "Good match", plain: "Meets most requirements; gaps are secondary" },
  { min: 0.5, label: "Partial match", plain: "Meets some requirements; at least one real gap" },
  { min: 0.3, label: "Weak match", plain: "Adjacent experience, but misses the core of the role" },
  { min: 0, label: "Not a match", plain: "Different role, domain, or seniority" },
] as const;

export function bandFor(score01: number) {
  return BANDS.find((b) => score01 >= b.min) ?? BANDS[BANDS.length - 1];
}

export const MATCH_TYPE_LABELS: Record<string, string> = {
  strong: "Strong",
  good: "Good",
  partial: "Partial",
  hard_negative: "Hard negative",
  weak: "Weak",
};

/** Ordered worst→best so charts read left-to-right in label order rather than alphabetically. */
export const MATCH_TYPE_ORDER = ["strong", "good", "partial", "hard_negative", "weak"];

export function fmt(n: number | null | undefined, digits = 3): string {
  return n === null || n === undefined || Number.isNaN(n) ? "n/a" : n.toFixed(digits);
}

/** Spearman/MAE for an arbitrary subset, used when the explorer's filters narrow the set,
 *  so the headline recomputes over what is actually on screen rather than showing the
 *  full-set number beside a filtered scatter. */
export function subsetMetrics(
  pairs: BenchmarkPair[],
  engineId: string,
): { spearman: number | null; mae: number | null; n: number } {
  const rows = pairs
    .filter((p) => typeof p.preds[engineId] === "number")
    .map((p) => [p.true, p.preds[engineId]] as const);
  if (rows.length < 3) return { spearman: null, mae: null, n: rows.length };

  const mae = rows.reduce((sum, [t, v]) => sum + Math.abs(t - v), 0) / rows.length;
  return { spearman: spearman(rows.map((r) => r[0]), rows.map((r) => r[1])), mae, n: rows.length };
}

/** Spearman's rho with average ranks for ties. Ties matter here: the labels come from a
 *  five-band rubric, so exact duplicates are common and naive ranking would bias rho. */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

function rank(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
