"use client";

import { useEffect, useMemo, useState } from "react";
import { CalibrationScatter } from "@/components/charts/CalibrationScatter";
import { MetricBars, type MetricRow } from "@/components/charts/MetricBars";
import { Card, Detail } from "@/components/demo/Section";
import {
  MATCH_TYPE_LABELS,
  MATCH_TYPE_ORDER,
  fmt,
  subsetMetrics,
  type Benchmark,
  type BenchmarkPair,
  type BenchmarkSummary,
} from "@/lib/benchmark";

/**
 * The held-out benchmark, explorable.
 *
 * A metrics table asks to be believed. This asks to be checked: pick an engine, filter to
 * the cases you care about, and read the actual resume and job posting behind any point
 * on the chart, including the ones the model got wrong. The 650 KB of pair text is
 * fetched only when this section is opened, so it never taxes the initial load.
 */
export function BenchmarkExplorer({ summary }: { summary: BenchmarkSummary }) {
  const [full, setFull] = useState<Benchmark | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const available = summary.engines.filter((e) => e.available);
  const [engineId, setEngineId] = useState(available[0]?.id ?? "");
  const [matchType, setMatchType] = useState<string>("all");
  const [industry, setIndustry] = useState<string>("all");
  const [selected, setSelected] = useState<BenchmarkPair | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetch("/benchmark.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Benchmark) => {
        if (!cancelled) {
          setFull(data);
          setLoadState("idle");
        }
      })
      .catch(() => !cancelled && setLoadState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!full) return [];
    return full.pairs.filter(
      (p) =>
        (matchType === "all" || p.matchType === matchType) &&
        (industry === "all" || p.industry === industry),
    );
  }, [full, matchType, industry]);

  const live = engineId ? subsetMetrics(filtered, engineId) : null;
  const engine = summary.engines.find((e) => e.id === engineId);
  const isFiltered = matchType !== "all" || industry !== "all";

  const rows: MetricRow[] = summary.engines
    .filter((e) => e.available)
    .map((e) => ({
      id: e.id,
      label: e.short,
      value: summary.metrics[e.id]?.spearman ?? null,
      ci: summary.metrics[e.id]?.spearman_ci95 ?? null,
      highlight: e.id === "finetuned_calibrated",
    }));

  if (available.length === 0) {
    return (
      <Card>
        <p className="text-sm">
          No engine predictions are bundled yet. Run{" "}
          <code className="text-xs">Notebooks/05_production.ipynb</code> then{" "}
          <code className="text-xs">Notebooks/06_model_audit.ipynb</code>, drop{" "}
          <code className="text-xs">demo_pairs.json</code> into <code className="text-xs">Results/</code>,
          and run <code className="text-xs">python scripts/build_demo_data.py</code>.
        </p>
        {summary.meta.notes.map((n, i) => (
          <p key={i} className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            {n}
          </p>
        ))}
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Ranking quality across engines ── */}
      <Card>
        <h3 className="text-sm font-semibold">Ranking quality on {summary.nPairs} unseen pairs</h3>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Spearman correlation: does the engine put the candidates in the right order? 1.0 is a
          perfect ordering and 0 is chance. The whiskers are 95% bootstrap intervals. Where two
          whiskers overlap, the engines are not distinguishable on this test set, however
          different the bars look.
        </p>
        <div className="mt-4">
          <MetricBars
            rows={rows}
            caption="Higher is better. Intervals from 2,000 bootstrap resamples of the same 106 pairs."
          />
        </div>

        <Detail summary="See the numbers as a table">
          <div className="scroll-x">
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="py-2 pr-4 font-medium">Engine</th>
                  <th className="py-2 pr-4 font-medium">Spearman</th>
                  <th className="py-2 pr-4 font-medium">95% CI</th>
                  <th className="py-2 pr-4 font-medium">MAE</th>
                  <th className="py-2 font-medium">Kind</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {summary.engines
                  .filter((e) => e.available)
                  .map((e) => {
                    const m = summary.metrics[e.id];
                    return (
                      <tr key={e.id} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                        <td className="py-2 pr-4" style={{ color: "var(--text-primary)" }}>
                          {e.label}
                        </td>
                        <td className="py-2 pr-4">{fmt(m?.spearman)}</td>
                        <td className="py-2 pr-4">
                          {m?.spearman_ci95 ? `${fmt(m.spearman_ci95[0])} to ${fmt(m.spearman_ci95[1])}` : "n/a"}
                        </td>
                        <td className="py-2 pr-4">{m?.mae === null ? "n/a" : fmt(m?.mae)}</td>
                        <td className="py-2">{e.kind}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p>
            MAE is omitted for the word-matching baselines on purpose. Their output is a similarity
            in its own units rather than an estimate of the 0 to 1 label, so an absolute error
            against that label would be meaningless. Only their ordering is comparable.
          </p>
        </Detail>
      </Card>

      {/* ── Per-engine calibration view ── */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Where each engine puts each candidate</h3>
            <p className="mt-1 max-w-xl text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Every dot is one resume scored against one job posting. Horizontal is the true
              label; vertical is what the engine predicted.
            </p>
          </div>
        </div>

        {/* Filters in one row above the chart */}
        <div className="mt-4 flex flex-wrap gap-3">
          <Select label="Engine" value={engineId} onChange={setEngineId}
            options={available.map((e) => ({ value: e.id, label: e.label }))} />
          <Select label="Match type" value={matchType} onChange={setMatchType}
            options={[{ value: "all", label: "All" }, ...MATCH_TYPE_ORDER
              .filter((m) => summary.matchTypes.includes(m))
              .map((m) => ({ value: m, label: MATCH_TYPE_LABELS[m] ?? m }))]} />
          <Select label="Industry" value={industry} onChange={setIndustry}
            options={[{ value: "all", label: "All" }, ...summary.industries.map((i) => ({ value: i, label: i }))]} />
        </div>

        {engine && (
          <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {engine.plain}
          </p>
        )}

        {loadState === "loading" && (
          <p className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Loading the benchmark…
          </p>
        )}
        {loadState === "error" && (
          <p className="py-16 text-center text-sm" style={{ color: "var(--status-critical)" }}>
            Could not load benchmark.json.
          </p>
        )}

        {full && (
          <>
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
              <CalibrationScatter
                pairs={filtered}
                engineId={engineId}
                engineLabel={engine?.label ?? engineId}
                onSelect={setSelected}
              />

              <div className="space-y-4">
                <div>
                  <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    {isFiltered ? "On the filtered subset" : "On all pairs"}
                  </div>
                  <div className="tnum mt-1 text-2xl font-semibold">{fmt(live?.spearman)}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Spearman · n = {live?.n ?? 0}
                  </div>
                </div>
                <div>
                  <div className="tnum text-2xl font-semibold">{fmt(live?.mae)}</div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Mean absolute error
                  </div>
                </div>
                {isFiltered && (
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Recomputed over the {live?.n} pairs currently shown. Small subsets move a lot 
                    treat anything under ~20 pairs as directional.
                  </p>
                )}
              </div>
            </div>

            {selected && <PairDetail pair={selected} summary={summary} onClose={() => setSelected(null)} />}
          </>
        )}
      </Card>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-xs">
      <span className="block font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-lg border px-2 py-1.5 text-sm"
        style={{ borderColor: "var(--hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The whole point of shipping the pair text: you can read the case the model got wrong. */
function PairDetail({
  pair,
  summary,
  onClose,
}: {
  pair: BenchmarkPair;
  summary: BenchmarkSummary;
  onClose: () => void;
}) {
  return (
    <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold">
            {pair.jdPosition ?? "Job posting"}
            {pair.industry ? ` · ${pair.industry}` : ""}
          </h4>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            True label {pair.true.toFixed(2)} · {MATCH_TYPE_LABELS[pair.matchType] ?? pair.matchType}
            {pair.jdLevel ? ` · ${pair.jdLevel} level` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-sm" style={{ color: "var(--text-muted)" }}>
          Close
        </button>
      </div>

      <div className="scroll-x mt-3">
        <table className="w-full text-left text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-1.5 pr-4 font-medium">Engine</th>
              <th className="py-1.5 pr-4 font-medium">Predicted</th>
              <th className="py-1.5 font-medium">Off by</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {summary.engines
              .filter((e) => typeof pair.preds[e.id] === "number")
              .map((e) => (
                <tr key={e.id} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                  <td className="py-1.5 pr-4" style={{ color: "var(--text-primary)" }}>
                    {e.label}
                  </td>
                  <td className="py-1.5 pr-4">{pair.preds[e.id].toFixed(3)}</td>
                  <td className="py-1.5">{Math.abs(pair.preds[e.id] - pair.true).toFixed(3)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TextPane title="Resume" body={pair.resume} />
        <TextPane title="Job description" body={pair.jd} />
      </div>
    </div>
  );
}

function TextPane({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </div>
      <pre
        className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-xs leading-relaxed"
        style={{ borderColor: "var(--hairline)", background: "var(--page)", fontFamily: "inherit" }}
      >
        {body}
      </pre>
    </div>
  );
}
