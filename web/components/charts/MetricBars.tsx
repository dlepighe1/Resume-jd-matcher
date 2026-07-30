"use client";

/**
 * Ranking quality by engine, with bootstrap confidence intervals.
 *
 * One measure across categories, so it is one series in one hue, not seven categorical
 * colours. Colour here would encode nothing that the row label doesn't already say.
 *
 * The intervals are the point of the chart. On 106 pairs they are roughly ±0.10 wide,
 * which means several of these engines are not distinguishable from each other however
 * confidently the bars are drawn. Rendering the bars without the whiskers would invite
 * exactly the misreading this project exists to argue against.
 */

export interface MetricRow {
  id: string;
  label: string;
  value: number | null;
  ci: [number, number] | null;
  /** Drawn in the accent hue and labelled, the engine this project actually ships. */
  highlight?: boolean;
  note?: string;
}

const ROW_H = 38;
const LABEL_W = 190;
const PAD_R = 62;

export function MetricBars({
  rows,
  domain = [0, 1],
  caption,
}: {
  rows: MetricRow[];
  domain?: [number, number];
  caption?: string;
}) {
  const drawn = rows.filter((r) => r.value !== null);
  if (drawn.length === 0) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        No metrics available yet, run the notebooks and rebuild the benchmark bundle.
      </p>
    );
  }

  const H = drawn.length * ROW_H + 34;
  const W = 640;
  const plotW = W - LABEL_W - PAD_R;
  const [lo, hi] = domain;
  const x = (v: number) => LABEL_W + ((v - lo) / (hi - lo)) * plotW;

  const ticks = [0, 0.25, 0.5, 0.75, 1].filter((t) => t >= lo && t <= hi);

  return (
    <figure className="m-0">
      <div className="scroll-x">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 520 }}
          role="img"
          aria-label={`Bar chart of ranking quality by engine. ${drawn
            .map((r) => `${r.label}: ${r.value?.toFixed(3)}`)
            .join("; ")}. A table with the same values follows.`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={16} x2={x(t)} y2={H - 18} stroke="var(--grid)" strokeWidth="1" />
              <text x={x(t)} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--text-muted)" className="tnum">
                {t}
              </text>
            </g>
          ))}

          {drawn.map((row, i) => {
            const yTop = 16 + i * ROW_H;
            const cy = yTop + ROW_H / 2 - 6;
            const barH = 14;
            const fill = row.highlight ? "var(--series-1)" : "var(--series-3)";

            return (
              <g key={row.id}>
                <text
                  x={LABEL_W - 12}
                  y={cy + 5}
                  textAnchor="end"
                  fontSize="12"
                  fill={row.highlight ? "var(--text-primary)" : "var(--text-secondary)"}
                  fontWeight={row.highlight ? 600 : 400}
                >
                  {row.label}
                </text>

                {/* 4px rounded data-end, anchored to the baseline */}
                <rect
                  x={x(Math.min(0, row.value!))}
                  y={cy - barH / 2}
                  width={Math.max(1, x(row.value!) - x(Math.min(0, row.value!)))}
                  height={barH}
                  rx="4"
                  fill={fill}
                />

                {row.ci && (
                  <g stroke="var(--text-secondary)" strokeWidth="1.5">
                    <line x1={x(row.ci[0])} y1={cy} x2={x(row.ci[1])} y2={cy} />
                    <line x1={x(row.ci[0])} y1={cy - 5} x2={x(row.ci[0])} y2={cy + 5} />
                    <line x1={x(row.ci[1])} y1={cy - 5} x2={x(row.ci[1])} y2={cy + 5} />
                  </g>
                )}

                {/* Direct label, every bar carries its number, so the aqua fill never
                    has to clear 3:1 on its own. */}
                <text
                  x={W - PAD_R + 8}
                  y={cy + 5}
                  fontSize="12"
                  fill="var(--text-primary)"
                  className="tnum"
                  fontWeight={row.highlight ? 600 : 400}
                >
                  {row.value!.toFixed(3)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {caption && (
        <figcaption className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
