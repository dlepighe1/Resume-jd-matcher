import { env } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";

/**
 * Un-fine-tuned `all-mpnet-base-v2` on the same pair, via the scoring service.
 *
 * This exists so a visitor can see what fine-tuning bought *on their own resume*, not
 * only on the benchmark. It is the single most convincing thing the page can show: the
 * same architecture, the same preprocessing, the same input, minus this project's
 * training.
 *
 * It deliberately returns `rawCosine` and no `score`. The Platt calibrator maps the
 * fine-tuned model's cosine distribution; applying it here would produce a confident,
 * well-formatted number that means nothing, the exact failure the service's own test
 * suite guards against. The UI renders this value as a raw similarity and says so.
 */

const TIMEOUT_MS = 120_000;

export interface BaselineScore {
  rawCosine: number;
  modelId: string;
  calibrated: false;
}

export async function scoreWithBaseModel(
  jobDescription: string,
  resumeText: string,
): Promise<BaselineScore> {
  const baseUrl = env.scoringService.url.replace(/\/$/, "");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/baseline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: resumeText, jd: jobDescription }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AnalyzeError(
      "MODEL_SERVICE_UNREACHABLE",
      timedOut
        ? "The baseline model did not respond in time. It loads on first use, so the very first comparison can take a while."
        : `Could not reach the scoring service at ${baseUrl}.`,
      503,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AnalyzeError(
      "PROVIDER_ERROR",
      `Baseline endpoint returned ${response.status}. ${body.slice(0, 200)}`,
      502,
    );
  }

  const data = (await response.json()) as { raw_cosine: number; model_id: string };
  return { rawCosine: data.raw_cosine, modelId: data.model_id, calibrated: false };
}
