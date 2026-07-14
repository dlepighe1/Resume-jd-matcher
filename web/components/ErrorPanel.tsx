import { XCircleIcon } from "@/components/icons";

export interface AnalyzeFailure {
  code: string;
  message: string;
  retryAfter?: number;
}

/** What the user should do next, per failure kind. The message from the API says what
 *  went wrong; this says whether it's worth trying again — and those are different
 *  questions. A cold model service and a safety refusal must not look alike. */
const NEXT_STEP: Record<string, string> = {
  MODEL_SERVICE_UNREACHABLE:
    "The scoring service may be waking from idle. Give it a moment and try again — or switch to Claude.",
  RATE_LIMITED: "Wait a moment and try again, or switch engines.",
  INVALID_OUTPUT:
    "Free models are unreliable at structured output. Claude constrains the format, so it will not fail this way.",
  REFUSED: "Retrying will not help. Try different text.",
  CONFIG_ERROR: "This is a server configuration problem, not something you did wrong.",
  NETWORK: "Check your connection and try again.",
};

export function ErrorPanel({ failure }: { failure: AnalyzeFailure }) {
  const nextStep = NEXT_STEP[failure.code];

  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 p-5 dark:border-rose-900 dark:bg-rose-950/50"
    >
      <div className="flex gap-3">
        <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-sm font-semibold text-rose-900 dark:text-rose-200">
            Analysis failed
          </p>
          <p className="text-sm leading-relaxed text-rose-800 dark:text-rose-300">
            {failure.message}
          </p>
          {nextStep && (
            <p className="text-sm leading-relaxed text-rose-700 dark:text-rose-400">{nextStep}</p>
          )}
          {failure.retryAfter && (
            <p className="tabular font-mono text-xs text-rose-700 dark:text-rose-400">
              Retry after {failure.retryAfter}s
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
