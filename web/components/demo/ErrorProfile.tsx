import { Card, Detail } from "@/components/demo/Section";
import { fmt, MATCH_TYPE_LABELS, MATCH_TYPE_ORDER, type Benchmark } from "@/lib/benchmark";

type Audit = NonNullable<Benchmark["audit"]>;

/**
 * Where the model is wrong, and in which direction.
 *
 * A single mean absolute error hides the shape of the error. Split by match type, this
 * model turns out to miss in a consistent direction: it underscores strong candidates and
 * overscores weak ones. That is the most important caveat in the study for anyone reading
 * a score as a percentage, so it is shown rather than left in a JSON file.
 */
export function ErrorProfile({ audit }: { audit: Audit }) {
  const byType = audit.by_match_type;
  const subtypes = audit.hard_negative_subtypes;
  const calibration = audit.calibration;
  if (!byType) return null;

  const rows = MATCH_TYPE_ORDER.filter((t) => byType[t]).map((t) => ({ type: t, ...byType[t] }));
  const widest = Math.max(...rows.map((r) => Math.abs(r.bias)), 0.01);

  return (
    <Card>
      <h3 className="text-sm font-semibold">Where the score is wrong, and in which direction</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Splitting the error by the kind of pair shows it is not random. The model pulls
        everything toward the middle of the scale: strong candidates come out too low, weak
        ones too high.
      </p>

      <div className="scroll-x mt-4">
        <table className="w-full min-w-[460px] text-left text-sm">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-2 pr-4 text-xs font-medium">Pair type</th>
              <th className="py-2 pr-4 text-right text-xs font-medium">Pairs</th>
              <th className="py-2 pr-4 text-right text-xs font-medium">Direction</th>
              <th className="py-2 text-xs font-medium">Scored too low / too high</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = (Math.abs(r.bias) / widest) * 50;
              const low = r.bias < 0;
              return (
                <tr key={r.type} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                  <td className="py-2 pr-4">{MATCH_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="tnum py-2 pr-4 text-right" style={{ color: "var(--text-muted)" }}>
                    {r.n}
                  </td>
                  <td className="tnum py-2 pr-4 text-right">
                    {r.bias >= 0 ? "+" : ""}
                    {fmt(r.bias)}
                  </td>
                  <td className="py-2">
                    {/* Zero sits at the centre, so direction reads without consulting the sign. */}
                    <div className="relative h-2.5 w-full" aria-hidden="true">
                      <div
                        className="absolute inset-y-0 left-1/2 w-px"
                        style={{ background: "var(--hairline)" }}
                      />
                      <div
                        className="absolute inset-y-0 rounded-sm"
                        style={{
                          width: `${pct}%`,
                          [low ? "right" : "left"]: "50%",
                          background: low ? "var(--series-2)" : "var(--series-1)",
                        }}
                      />
                    </div>
                    <span className="sr-only">
                      {low ? "scored too low by " : "scored too high by "}
                      {fmt(Math.abs(r.bias))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        The consequence is specific. Read the score as a ranking signal, which is what it is
        measured on, and not as a percentage fit. Ranking is unaffected by this compression,
        which is why the model still picks the right candidate on most postings while its
        absolute error on strong pairs is the worst of any group.
      </p>

      <Detail summary="Calibration detail and the adversarial cases">
        {calibration && (
          <p>
            Expected calibration error is{" "}
            <span className="tnum">{fmt(calibration.ece)}</span>. Predictions span{" "}
            <span className="tnum">{fmt(calibration.pred_range[0], 2)}</span> to{" "}
            <span className="tnum">{fmt(calibration.pred_range[1], 2)}</span> while the labels
            span <span className="tnum">{fmt(calibration.true_range[0], 2)}</span> to{" "}
            <span className="tnum">{fmt(calibration.true_range[1], 2)}</span>. The model never
            uses the top of the scale, which is the same compression the table above shows.
          </p>
        )}
        {subtypes && (
          <>
            <p>
              The training set includes deliberately adversarial negatives. Split by kind, the
              model handles two of the three well:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {Object.entries(subtypes).map(([name, v]) => (
                <li key={name}>
                  <span className="capitalize">{name.replace(/_/g, " ")}</span>:{" "}
                  <span className="tnum">{fmt(v.mae)}</span> error across{" "}
                  <span className="tnum">{v.n}</span> pairs
                </li>
              ))}
            </ul>
            <p>
              Resumes that merely share vocabulary with the posting, and resumes from an
              adjacent specialisation, are both scored better than the model&rsquo;s average.
              The remaining weakness is the genuinely impressive resume from the wrong field,
              which still scores higher than it should.
            </p>
          </>
        )}
      </Detail>
    </Card>
  );
}
