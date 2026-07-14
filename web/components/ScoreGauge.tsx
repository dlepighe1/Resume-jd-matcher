import { verdictFor, type AnalysisResult } from "@/lib/types";

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreGauge({
  score,
  errorBand,
}: {
  score: number;
  errorBand?: AnalysisResult["errorBand"];
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const verdict = verdictFor(clamped);
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative"
        role="img"
        aria-label={`Match score ${clamped} out of 100. ${verdict.label}.`}
      >
        <svg viewBox="0 0 128 128" className="h-36 w-36 -rotate-90">
          <circle
            cx="64"
            cy="64"
            r={RADIUS}
            fill="none"
            strokeWidth="10"
            className="stroke-slate-200 dark:stroke-slate-800"
          />
          <circle
            cx="64"
            cy="64"
            r={RADIUS}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            className={`${verdict.ring} transition-[stroke-dashoffset] duration-500 ease-out`}
          />
        </svg>
        {/* The number is the signal; the ring colour only reinforces it. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular font-mono text-4xl font-semibold text-slate-900 dark:text-slate-50">
            {clamped}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>
        </div>
      </div>

      <p className={`font-mono text-sm font-semibold ${verdict.text}`}>{verdict.label}</p>

      {/* An error band, not a confidence interval — and labelled as what it actually is. */}
      {errorBand && (
        <p className="max-w-44 text-center text-xs text-slate-500 dark:text-slate-400">
          <span className="tabular font-mono">
            {errorBand.low}–{errorBand.high}
          </span>
          <br />
          {errorBand.basis}
        </p>
      )}
    </div>
  );
}
