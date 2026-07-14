import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { env } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";
import { SYSTEM_PROMPT, analysisSchema, userPrompt } from "@/lib/schema";
import { PROVIDER_META, type AnalysisResult } from "@/lib/types";

export async function analyzeWithClaude(
  jobDescription: string,
  resumeText: string,
): Promise<AnalysisResult> {
  // Constructed per-call, not at module scope: a missing ANTHROPIC_API_KEY must fail
  // only when someone actually selects Claude, not at import time (which would take
  // the whole route down, including the providers that are configured).
  const client = new Anthropic({ apiKey: env.anthropic.apiKey });
  const modelId = env.anthropic.model;
  const startedAt = Date.now();

  let message;
  try {
    message = await client.messages.parse({
      model: modelId,
      max_tokens: 4096,
      // Adaptive thinking is the only supported on-mode for current Opus models, and it
      // is off unless requested. temperature/top_p are rejected outright — behaviour is
      // steered by the prompt, not by sampling knobs.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        // Constrains decoding to the schema — this is what makes malformed JSON a
        // non-issue on this path, rather than something we retry our way out of.
        format: zodOutputFormat(analysisSchema),
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(jobDescription, resumeText) }],
    });
  } catch (error) {
    throw toAnalyzeError(error);
  }

  // A safety refusal comes back as a successful HTTP 200 with empty content — check
  // stop_reason before reading the result, or this surfaces as a confusing parse error.
  if (message.stop_reason === "refusal") {
    throw new AnalyzeError(
      "REFUSED",
      "Claude declined to analyze this content. Retrying will not help — try different text.",
      422,
    );
  }

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new AnalyzeError(
      "INVALID_OUTPUT",
      `Claude returned no parseable result (stop_reason: ${message.stop_reason}).`,
      502,
    );
  }

  return {
    matchScore: Math.max(0, Math.min(100, Math.round(parsed.matchScore))),
    matchedSkills: parsed.matchedSkills,
    missingSkills: parsed.missingSkills,
    strengths: parsed.strengths,
    suggestedBullets: parsed.suggestedBullets,
    summary: parsed.summary,
    meta: {
      provider: "claude",
      modelId,
      latencyMs: Date.now() - startedAt,
      calibrated: PROVIDER_META.claude.capabilities.calibrated,
    },
  };
}

/** Most specific SDK error class first — a single broad catch would throw away the
 *  distinction between "retry in 30s" and "your key is wrong". */
function toAnalyzeError(error: unknown): AnalyzeError {
  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get?.("retry-after");
    const retryAfter = header ? Number(header) : 30;
    return new AnalyzeError(
      "RATE_LIMITED",
      "Claude is rate limiting this API key. Try again shortly.",
      429,
      Number.isFinite(retryAfter) ? retryAfter : 30,
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AnalyzeError(
      "CONFIG_ERROR",
      "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.",
      500,
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AnalyzeError(
      "CONFIG_ERROR",
      `Model "${env.anthropic.model}" was not found. Check ANTHROPIC_MODEL.`,
      500,
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AnalyzeError("PROVIDER_ERROR", "Could not reach the Anthropic API.", 502);
  }
  if (error instanceof Anthropic.APIError) {
    return new AnalyzeError("PROVIDER_ERROR", `Anthropic API error: ${error.message}`, 502);
  }
  return new AnalyzeError(
    "PROVIDER_ERROR",
    error instanceof Error ? error.message : "Unknown Claude error.",
    502,
  );
}
