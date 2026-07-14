import { env } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";
import { PROVIDER_META, type AnalysisResult, type RequirementStatus } from "@/lib/types";

/** Free HuggingFace Spaces sleep when idle; the first request has to wake the
 *  container and load ~420 MB of weights. */
const TIMEOUT_MS = 120_000;

/**
 * The model's measured mean absolute error on 106 held-out pairs from 53 job postings it
 * never saw during training (Notebook 06). Reported as a band around the score.
 *
 * This is deliberately NOT dressed up as a per-pair confidence interval. We have no
 * principled way to compute one for a single prediction, and inventing a plausible-looking
 * one would be exactly the kind of false rigour this project exists to argue against.
 */
const HELD_OUT_MAE_POINTS = 10;

interface ScoreResponse {
  score: number; // 0-1, calibrated
  raw_cosine: number;
  calibrator: string | null;
  model_id: string;
  requirements: Array<{
    requirement: string;
    status: RequirementStatus;
    similarity: number;
    evidence: string;
  }>;
  coverage: number;
}

/**
 * The fine-tuned MPNet + Platt calibrator, served by the Python service.
 *
 * This provider generates no language at all — it embeds, scores, and locates gaps.
 * That's why AnalysisResult leaves summary/suggestedBullets optional: pretending an
 * embedding model can write interview-defensible bullets would be a lie the UI tells.
 */
export async function analyzeWithFineTuned(
  jobDescription: string,
  resumeText: string,
): Promise<AnalysisResult> {
  const baseUrl = env.scoringService.url.replace(/\/$/, "");
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/score`, {
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
        ? "The scoring service did not respond in time. If it has been idle it may still be waking up — try again in a moment."
        : `Could not reach the scoring service at ${baseUrl}. Is it running?`,
      503,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AnalyzeError(
      "PROVIDER_ERROR",
      `Scoring service returned ${response.status}. ${body.slice(0, 200)}`,
      502,
    );
  }

  const data = (await response.json()) as ScoreResponse;

  const covered = data.requirements.filter((r) => r.status === "covered");
  const partial = data.requirements.filter((r) => r.status === "partial");
  const missing = data.requirements.filter((r) => r.status === "missing");

  const matchScore = Math.max(0, Math.min(100, Math.round(data.score * 100)));
  const calibrated = Boolean(data.calibrator);

  return {
    matchScore,
    // Only meaningful for the calibrated model — the MAE was measured on *that* model.
    // Quoting it next to an uncalibrated base-MPNet score would be borrowing credibility
    // the number in front of you hasn't earned.
    errorBand: calibrated
      ? {
          low: Math.max(0, matchScore - HELD_OUT_MAE_POINTS),
          high: Math.min(100, matchScore + HELD_OUT_MAE_POINTS),
          basis: "typical error on 106 held-out pairs from unseen postings",
        }
      : undefined,
    matchedSkills: covered.map((r) => r.requirement),
    // A partially-covered requirement is still a gap, so it belongs in the gap list —
    // but it is a different kind of gap from one with no evidence at all, and the label
    // says so rather than flattening the two together.
    missingSkills: [
      ...missing.map((r) => r.requirement),
      ...partial.map((r) => `Partially covered — ${r.requirement}`),
    ],
    // The model's own evidence lines: the resume sentences it matched each requirement
    // against. Every "strength" here is therefore traceable by construction.
    strengths: [...new Set(covered.map((r) => r.evidence).filter(Boolean))].slice(0, 4),
    meta: {
      provider: "finetuned",
      modelId: data.model_id,
      latencyMs: Date.now() - startedAt,
      calibrated: calibrated && PROVIDER_META.finetuned.capabilities.calibrated,
    },
  };
}
