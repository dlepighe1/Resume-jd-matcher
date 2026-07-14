"use client";

import Link from "next/link";
import { useState } from "react";

import type { ComparisonOutcome } from "@/app/api/compare/route";
import { ScoreGauge } from "@/components/ScoreGauge";
import { SpinnerIcon, TrendingUpIcon, XCircleIcon } from "@/components/icons";
import { EXAMPLE_JD, EXAMPLE_RESUME } from "@/lib/examples";
import {
  MIN_WORDS,
  PROVIDERS,
  PROVIDER_META,
  wordCount,
  type ProviderId,
} from "@/lib/types";

type Outcomes = Record<ProviderId, ComparisonOutcome>;

export default function ComparePage() {
  const [jobDescription, setJobDescription] = useState(EXAMPLE_JD);
  const [resumeText, setResumeText] = useState(EXAMPLE_RESUME);
  const [outcomes, setOutcomes] = useState<Outcomes | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const ready =
    wordCount(jobDescription) >= MIN_WORDS && wordCount(resumeText) >= MIN_WORDS && !isRunning;

  async function runComparison() {
    setIsRunning(true);
    setOutcomes(null);
    try {
      const response = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, resumeText }),
      });
      const data = await response.json();
      if (response.ok) setOutcomes(data.results);
    } finally {
      setIsRunning(false);
    }
  }

  const scores = outcomes
    ? PROVIDERS.filter((id) => outcomes[id]?.ok).map(
        (id) => (outcomes[id] as { ok: true; result: { matchScore: number } }).result.matchScore,
      )
    : [];
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <Link
          href="/"
          className="font-mono text-xs text-slate-500 underline-offset-4 hover:underline dark:text-slate-400"
        >
          ← Back to the analyzer
        </Link>
        <h1 className="mt-3 font-mono text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Three engines, one pair
        </h1>
        <p className="mt-2 max-w-3xl leading-relaxed text-slate-600 dark:text-slate-400">
          The same resume and job description scored by a purpose-built fine-tuned model, by
          Claude, and by a free open-weights model. Where they disagree is the interesting part —
          and only one of them has an external-validation number behind it.
        </p>
      </header>

      {/* Provenance. Without this the comparison is three numbers with no way to judge them. */}
      <section className="mb-8 overflow-x-auto rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
          What each engine has actually been measured on
        </h2>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 font-mono text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="pb-2 font-medium">Engine</th>
              <th className="pb-2 font-medium">External validation</th>
              <th className="pb-2 font-medium">Calibrated</th>
              <th className="pb-2 font-medium">Writes feedback</th>
            </tr>
          </thead>
          <tbody className="text-slate-700 dark:text-slate-300">
            <tr className="border-b border-slate-100 dark:border-slate-800/60">
              <td className="py-2.5 font-mono text-xs">Fine-tuned MPNet</td>
              <td className="py-2.5">
                <span className="tabular font-mono text-xs">0.86 Spearman / 0.10 MAE</span> on 106
                held-out pairs from 53 unseen postings
              </td>
              <td className="py-2.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                yes (Platt)
              </td>
              <td className="py-2.5 font-mono text-xs text-slate-500">no</td>
            </tr>
            <tr className="border-b border-slate-100 dark:border-slate-800/60">
              <td className="py-2.5 font-mono text-xs">Claude</td>
              <td className="py-2.5 text-slate-500 dark:text-slate-400">
                none on this task — a general model, not measured against this label set
              </td>
              <td className="py-2.5 font-mono text-xs text-slate-500">no</td>
              <td className="py-2.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                yes
              </td>
            </tr>
            <tr>
              <td className="py-2.5 font-mono text-xs">Open-weights</td>
              <td className="py-2.5 text-slate-500 dark:text-slate-400">none on this task</td>
              <td className="py-2.5 font-mono text-xs text-slate-500">no</td>
              <td className="py-2.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                yes
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <CompactField
          id="cmp-jd"
          label="Job description"
          value={jobDescription}
          onChange={setJobDescription}
          disabled={isRunning}
        />
        <CompactField
          id="cmp-resume"
          label="Resume"
          value={resumeText}
          onChange={setResumeText}
          disabled={isRunning}
        />
      </div>

      <button
        type="button"
        onClick={runComparison}
        disabled={!ready}
        className="mb-8 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 font-mono text-sm font-semibold text-white transition-colors duration-200 hover:bg-[var(--color-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isRunning ? (
          <>
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            Running all three…
          </>
        ) : (
          <>
            <TrendingUpIcon className="h-4 w-4" />
            Compare engines
          </>
        )}
      </button>

      <div aria-live="polite" aria-busy={isRunning}>
        {spread !== null && (
          <p className="mb-4 rounded-lg bg-slate-100 px-4 py-3 font-mono text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Spread between engines:{" "}
            <span className="tabular font-semibold text-slate-900 dark:text-slate-50">
              {spread} points
            </span>
            {spread >= 15 && " — that is a large disagreement. The calibrated model is the one with evidence behind it."}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {PROVIDERS.map((id) => (
            <EngineColumn
              key={id}
              id={id}
              outcome={outcomes?.[id]}
              isRunning={isRunning}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function EngineColumn({
  id,
  outcome,
  isRunning,
}: {
  id: ProviderId;
  outcome?: ComparisonOutcome;
  isRunning: boolean;
}) {
  const meta = PROVIDER_META[id];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
        {meta.name}
      </h3>
      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{meta.tagline}</p>

      {isRunning && (
        <div className="h-40 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      )}

      {!isRunning && !outcome && (
        <p className="text-sm text-slate-500 dark:text-slate-500">Not run yet.</p>
      )}

      {/* One engine failing must not blank the others — that is the point of allSettled. */}
      {!isRunning && outcome && !outcome.ok && (
        <div className="flex gap-2 rounded-md bg-rose-50 p-3 dark:bg-rose-950/50">
          <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-rose-900 dark:text-rose-200">
              {outcome.error}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-rose-800 dark:text-rose-300">
              {outcome.message}
            </p>
          </div>
        </div>
      )}

      {!isRunning && outcome?.ok && (
        <div className="space-y-4">
          <ScoreGauge score={outcome.result.matchScore} />

          <p className="tabular text-center font-mono text-xs text-slate-500 dark:text-slate-400">
            {outcome.result.meta.latencyMs} ms ·{" "}
            {outcome.result.meta.calibrated ? "calibrated" : "uncalibrated"}
          </p>

          <div>
            <p className="mb-1.5 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
              Missing ({outcome.result.missingSkills.length})
            </p>
            <ul className="space-y-1">
              {outcome.result.missingSkills.slice(0, 4).map((skill) => (
                <li key={skill} className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {skill}
                </li>
              ))}
              {outcome.result.missingSkills.length === 0 && (
                <li className="text-xs text-slate-500">None flagged.</li>
              )}
            </ul>
          </div>

          {outcome.result.summary && (
            <p className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
              {outcome.result.summary}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CompactField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={7}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-800 focus-visible:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand)] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      />
    </div>
  );
}
