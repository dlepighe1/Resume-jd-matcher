import { Detail, Card } from "@/components/demo/Section";
import { fmt, type Engine, type Significance } from "@/lib/benchmark";

/**
 * Which differences between engines are larger than sampling noise.
 *
 * A benchmark table on its own invites the reader to treat 0.82 against 0.71 as a win. On
 * 106 pairs that is not something the table can settle, so the comparison is resampled and
 * the interval is shown next to the difference. Where a gap does not clear zero, this says
 * so in the same type size as the gaps that do.
 */
export function SignificanceTable({
  significance,
  engines,
}: {
  significance: Significance;
  engines: Engine[];
}) {
  const labelFor = (id: string) =>
    engines.find((e) => e.id === id)?.short ??
    ({ claude: "Claude Opus 4.5", base_mpnet: "Base MPNet", tfidf: "TF-IDF", jaccard: "Jaccard" }[id] ??
      id);

  const rows = significance.comparisons.filter((c) => c.metric === "spearman");
  const precision = significance.precision_at_1;
  const grouped = significance.grouped_calibration_check;

  return (
    <Card>
      <h3 className="text-sm font-semibold">Which of these differences are real</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Each row resamples the {significance.n_postings} postings in the test set{" "}
        {significance.resamples.toLocaleString()} times and re-scores both engines on the same
        resample. The interval is where the difference in ranking quality falls across those
        resamples. An interval that contains zero means the two engines cannot be separated on
        this test set.
      </p>

      <div className="scroll-x mt-4">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th className="py-2 pr-6 text-xs font-medium">Fine-tuned model against</th>
              <th className="py-2 pr-6 text-right text-xs font-medium">Difference</th>
              <th className="py-2 pr-6 text-right text-xs font-medium">95% interval</th>
              <th className="py-2 text-right text-xs font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.b} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                <td className="py-2 pr-6">{labelFor(c.b)}</td>
                <td className="tnum py-2 pr-6 text-right">
                  {c.difference >= 0 ? "+" : ""}
                  {fmt(c.difference)}
                </td>
                <td className="tnum py-2 pr-6 text-right" style={{ color: "var(--text-secondary)" }}>
                  {fmt(c.ci95[0], 2)} to {fmt(c.ci95[1], 2)}
                </td>
                <td
                  className="py-2 text-right"
                  style={{ color: c.significant ? "var(--series-3)" : "var(--text-muted)" }}
                >
                  {c.significant ? "Separated" : "Not separated"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        A separate measure, and the one closest to how the model would actually be used.
        Shown all four candidates for a posting and asked which fits best, it picks correctly
        on <span className="tnum">{precision.hits}</span> of{" "}
        <span className="tnum">{precision.postings}</span> postings, or{" "}
        <span className="tnum">{Math.round(precision.precision_at_1 * 100)}%</span>, against{" "}
        <span className="tnum">{Math.round(precision.random_baseline * 100)}%</span> for
        guessing. The interval runs{" "}
        <span className="tnum">{Math.round(precision.wilson_ci95[0] * 100)}%</span> to{" "}
        <span className="tnum">{Math.round(precision.wilson_ci95[1] * 100)}%</span>.
      </p>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        This figure covers all {precision.postings} external postings rather than the{" "}
        {significance.n_postings} in the half above, because ranking within a posting is
        unaffected by calibration and so the calibration half can be included without
        contaminating it. It is a different denominator from the comparison table, which is
        why it is stated separately.
      </p>

      <Detail summary="Method, and why the resampling unit is the posting">
        <p>
          Paired cluster bootstrap over {significance.resamples.toLocaleString()} resamples.
          Both engines score the identical resample, so the comparison is paired and the
          correlation between engines is preserved rather than assumed away.
        </p>
        <p>
          The {significance.n_pairs} pairs come from {significance.n_postings} postings, with
          up to four candidates per posting. Candidates for the same posting are not
          independent observations, so resampling pairs would count correlated evidence as
          fresh evidence and produce intervals that are too narrow. Postings are resampled
          instead.
        </p>
        {grouped.leave_one_posting_out_mae != null && (
          <p>
            One further check. The calibration and test halves were split by match type rather
            than grouped by posting, so most test postings contributed other candidates to the
            calibration set. Ranking cannot be affected by this, because calibration is
            monotonic, but absolute error could be. Refitting the calibrator with one posting
            held out at a time gives an error of{" "}
            <span className="tnum">{fmt(grouped.leave_one_posting_out_mae)}</span> against the
            reported <span className="tnum">{fmt(grouped.reported_mae)}</span>, a difference of{" "}
            <span className="tnum">{fmt(grouped.difference)}</span>. A posting-grouped split
            would still be the cleaner design.
          </p>
        )}
      </Detail>
    </Card>
  );
}
