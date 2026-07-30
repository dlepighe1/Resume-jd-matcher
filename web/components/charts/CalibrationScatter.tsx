"use client";

import { useState } from "react";
import { MATCH_TYPE_LABELS, type BenchmarkPair } from "@/lib/benchmark";

/**
 * Predicted vs true score on the held-out pairs.
 *
 * One engine at a time, one hue. The alternative, every engine overlaid in its own
 * colour, puts five to seven categorical hues in a scatter, which is exactly the case
 * the all-pairs colour gate fails. Switching engines instead of overlaying them keeps
 * the chart readable and keeps the comparison honest: you compare two pictures, not
 * seven clouds of dots fighting for the same pixels.
 *
 * The diagonal is perfect calibration. Distance above it is over-scoring, below it is
 * under-scoring, and the vertical spread at any x is the model's disagreement with the
 * rubric at that difficulty.
 */

const W = 520;
const H = 420;
const PAD = { top: 16, right: 16, bottom: 44, left: 52 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function CalibrationScatter({
  pairs,
  engineId,
  engineLabel,
  onSelect,
}: {
  pairs: BenchmarkPair[];
  engineId: string;
  engineLabel: string;
  onSelect?: (pair: BenchmarkPair) => void;
}) {
  const [hover, setHover] = useState<{ pair: BenchmarkPair; x: number; y: number } | null>(null);

  const points = pairs
    .filter((p) => typeof p.preds[engineId] === "number")
    .map((p) => ({ pair: p, t: p.true, v: p.preds[engineId] }));

  const x = (v: number) => PAD.left + v * PLOT_W;
  const y = (v: number) => PAD.top + (1 - v) * PLOT_H;

  if (points.length === 0) {
    return (
      <p className="grid h-[420px] place-items-center text-sm" style={{ color: "var(--text-muted)" }}>
        No predictions for {engineLabel} yet.
      </p>
    );
  }

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Scatter plot of ${engineLabel} predicted score against the true label for ${points.length} held-out pairs. Points on the diagonal are perfectly calibrated.`}
      >
        {/* Recessive grid, hairlines, never competing with the marks */}
        {TICKS.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={PAD.top} x2={x(t)} y2={PAD.top + PLOT_H} stroke="var(--grid)" strokeWidth="1" />
            <line x1={PAD.left} y1={y(t)} x2={PAD.left + PLOT_W} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
          </g>
        ))}

        {/* Perfect-calibration reference */}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(1)}
          y2={y(1)}
          stroke="var(--axis)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text
          x={x(0.97)}
          y={y(0.97) - 8}
          textAnchor="end"
          fontSize="11"
          fill="var(--text-muted)"
        >
          perfect
        </text>

        {/* Axes */}
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H} stroke="var(--axis)" strokeWidth="1" />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H} stroke="var(--axis)" strokeWidth="1" />

        {TICKS.map((t) => (
          <g key={`tick-${t}`}>
            <text x={x(t)} y={PAD.top + PLOT_H + 18} textAnchor="middle" fontSize="11" fill="var(--text-muted)" className="tnum">
              {t}
            </text>
            <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)" className="tnum">
              {t}
            </text>
          </g>
        ))}

        <text x={PAD.left + PLOT_W / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text-secondary)">
          True score (rubric label)
        </text>
        <text
          x={-(PAD.top + PLOT_H / 2)}
          y={14}
          transform="rotate(-90)"
          textAnchor="middle"
          fontSize="12"
          fill="var(--text-secondary)"
        >
          Predicted score
        </text>

        {/* Marks. 2px surface ring so overlapping dots stay countable. */}
        {points.map(({ pair, t, v }) => {
          const active = hover?.pair.id === pair.id;
          return (
            <circle
              key={pair.id}
              cx={x(t)}
              cy={y(v)}
              r={active ? 7 : 5}
              fill="var(--series-1)"
              fillOpacity={active ? 1 : 0.72}
              stroke="var(--surface-1)"
              strokeWidth="2"
              style={{ cursor: onSelect ? "pointer" : "default" }}
              onMouseEnter={() => setHover({ pair, x: x(t), y: y(v) })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(pair)}
            >
              <title>
                {`${MATCH_TYPE_LABELS[pair.matchType] ?? pair.matchType} · true ${t.toFixed(2)} · predicted ${v.toFixed(2)}`}
              </title>
            </circle>
          );
        })}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border px-3 py-2 text-xs shadow-lg"
          style={{
            left: `${(hover.x / W) * 100}%`,
            top: `${(hover.y / H) * 100}%`,
            transform: "translate(-50%, -125%)",
            background: "var(--surface-1)",
            borderColor: "var(--hairline)",
            color: "var(--text-primary)",
            minWidth: 170,
          }}
        >
          <div className="font-medium">{hover.pair.jdPosition ?? hover.pair.industry ?? "Pair"}</div>
          <div className="tnum mt-1" style={{ color: "var(--text-secondary)" }}>
            true {hover.pair.true.toFixed(2)} · predicted {hover.pair.preds[engineId].toFixed(2)}
          </div>
          <div className="mt-1" style={{ color: "var(--text-muted)" }}>
            {MATCH_TYPE_LABELS[hover.pair.matchType] ?? hover.pair.matchType}
            {hover.pair.industry ? ` · ${hover.pair.industry}` : ""}
          </div>
          {onSelect && (
            <div className="mt-1" style={{ color: "var(--text-muted)" }}>
              Click to read this pair
            </div>
          )}
        </div>
      )}

      <figcaption className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {points.length} held-out pairs · {engineLabel}. Above the dashed line the model scores
        the candidate more generously than the rubric; below it, more harshly.
      </figcaption>
    </figure>
  );
}
