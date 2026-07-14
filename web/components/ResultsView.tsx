import { ScoreGauge } from "@/components/ScoreGauge";
import { SkillList } from "@/components/SkillList";
import { SparklesIcon } from "@/components/icons";
import type { AtsAnalysis } from "@/lib/ats";
import { PROVIDER_META, type AnalysisResult } from "@/lib/types";

/**
 * Keyword coverage. Separate from the model's score on purpose: an applicant tracking
 * system matches literal strings, so this is what decides whether a human ever sees the
 * resume — regardless of how good the semantic fit is.
 */
function AtsPanel({ ats }: { ats: AtsAnalysis }) {
  const tone =
    ats.score >= 75
      ? "text-emerald-700 dark:text-emerald-400"
      : ats.score >= 50
        ? "text-amber-700 dark:text-amber-400"
        : "text-rose-700 dark:text-rose-400";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
          ATS keyword coverage
        </h3>
        <span className={`tabular font-mono text-lg font-semibold ${tone}`}>{ats.score}%</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Applicant tracking systems filter on literal keywords, not meaning. This is a
        separate check from the match score — no model involved.
      </p>

      <div
        className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        role="img"
        aria-label={`${ats.score} percent of the job description's keywords appear in the resume`}
      >
        <div
          className="h-full rounded-full bg-[var(--color-brand)] transition-[width] duration-500 ease-out"
          style={{ width: `${ats.score}%` }}
        />
      </div>

      {ats.missing.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
            In the posting, absent from the resume
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ats.missing.map((keyword) => (
              <span
                key={keyword}
                className="rounded-md bg-rose-50 px-2 py-1 font-mono text-xs text-rose-800 ring-1 ring-rose-600/20 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-400/20"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}

      {ats.matched.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
            Present in both
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ats.matched.map((keyword) => (
              <span
                key={keyword}
                className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Presentational only — no data fetching, no state. Rendered identically by the
 * analyzer page and by the public /results/[id] share page, so a shared link and
 * the live result can never drift apart.
 */
export function ResultsView({ result }: { result: AnalysisResult }) {
  const provider = PROVIDER_META[result.meta.provider];
  const { generativeFeedback } = provider.capabilities;

  return (
    <div className="space-y-6">
      {/* Score + provenance */}
      <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-[auto_1fr] dark:border-slate-800 dark:bg-slate-900">
        <ScoreGauge score={result.matchScore} errorBand={result.errorBand} />

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {provider.name}
            </span>
            {result.meta.calibrated ? (
              <span className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-800 ring-1 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20">
                calibrated
              </span>
            ) : (
              <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                uncalibrated
              </span>
            )}
            <span className="tabular font-mono text-xs text-slate-500 dark:text-slate-400">
              {result.meta.modelId} · {result.meta.latencyMs} ms
            </span>
          </div>

          {result.summary ? (
            <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
              {result.summary}
            </p>
          ) : (
            /* Honest about what this engine is, instead of leaving a blank panel. */
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {provider.name} is an embedding model, not a language model. It produces a
              calibrated score and a requirement-by-requirement gap — it does not write prose.
              Run the same pair through Claude for a written critique.
            </p>
          )}
        </div>
      </section>

      {/* A second, independent signal — and the one that decides whether a human ever
          reads the resume at all. Deliberately placed before the model's own output. */}
      {result.ats && <AtsPanel ats={result.ats} />}

      {/* Gaps first: they're the actionable part. */}
      <div className="grid gap-4 md:grid-cols-2">
        <SkillList
          title="Missing requirements"
          items={result.missingSkills}
          tone="missing"
          emptyMessage="Nothing significant missing — this resume covers the stated requirements."
        />
        <SkillList
          title="Matched requirements"
          items={result.matchedSkills}
          tone="covered"
          emptyMessage="No requirements matched."
        />
      </div>

      {result.strengths.length > 0 && (
        <SkillList
          title="Strengths"
          items={result.strengths}
          tone="neutral"
          emptyMessage="No standout strengths identified."
        />
      )}

      {generativeFeedback && result.suggestedBullets && result.suggestedBullets.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-1 flex items-center gap-2 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
            <SparklesIcon className="h-4 w-4 text-[var(--color-brand)]" />
            Suggested bullets
          </h3>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Rewrites grounded in experience the resume already shows — you should be able to
            defend every one of these in an interview.
          </p>
          <ul className="space-y-3">
            {result.suggestedBullets.map((bullet) => (
              <li
                key={bullet}
                className="border-l-2 border-[var(--color-brand)] bg-slate-50 py-2 pl-3 text-sm leading-relaxed text-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
              >
                {bullet}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
