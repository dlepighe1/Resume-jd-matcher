import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeAtsKeywords } from "@/lib/ats";
import { MissingEnvError, env, hasAnthropicKey } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";
import { scoreWithBaseModel } from "@/lib/providers/baseline";
import { analyzeWithClaude } from "@/lib/providers/claude";
import { analyzeWithFineTuned } from "@/lib/providers/finetuned";
import { MIN_WORDS, wordCount, type AnalysisResult } from "@/lib/types";

export const maxDuration = 120;

const MAX_CHARS = 15_000;

const requestSchema = z.object({
  jobDescription: z.string().max(MAX_CHARS),
  resumeText: z.string().max(MAX_CHARS),
  /** Claude costs money per call, so it is opt-in rather than fired on every keystroke. */
  includeClaude: z.boolean().optional(),
});

export type EngineOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string };

export interface ScoreResponse {
  ats: ReturnType<typeof analyzeAtsKeywords>;
  finetuned?: EngineOutcome<AnalysisResult>;
  baseline?: EngineOutcome<{ rawCosine: number; modelId: string }>;
  claude?: EngineOutcome<AnalysisResult>;
  /** What was even attempted, so the UI can explain an absence rather than a failure. */
  attempted: { finetuned: boolean; baseline: boolean; claude: boolean };
}

/**
 * Score one pair with every engine that is configured.
 *
 * `allSettled`, never `all`: the entire value of this page is seeing engines disagree,
 * and losing the fine-tuned model's answer because Claude was rate-limited would defeat
 * that. Each engine reports its own outcome and the UI renders partial results.
 *
 * Nothing is persisted. There is no database in this repo any more, a resume is PII and
 * a research demo has no business keeping one.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { jobDescription, resumeText, includeClaude = false } = parsed.data;
  if (wordCount(jobDescription) < MIN_WORDS || wordCount(resumeText) < MIN_WORDS) {
    return NextResponse.json(
      {
        error: "TOO_SHORT",
        message: `Both the job description and the resume need at least ${MIN_WORDS} words. Below that there isn't enough signal for a score worth showing.`,
      },
      { status: 400 },
    );
  }

  const serviceUp = env.scoringService.isConfigured;
  const claudeUp = includeClaude && hasAnthropicKey();

  const attempted = { finetuned: serviceUp, baseline: serviceUp, claude: claudeUp };

  const [finetuned, baseline, claude] = await Promise.allSettled([
    serviceUp ? analyzeWithFineTuned(jobDescription, resumeText) : skipped(),
    serviceUp ? scoreWithBaseModel(jobDescription, resumeText) : skipped(),
    claudeUp ? analyzeWithClaude(jobDescription, resumeText) : skipped(),
  ]);

  // Identical for every engine, a property of the two texts, not of any model.
  const ats = analyzeAtsKeywords(jobDescription, resumeText);

  const response: ScoreResponse = { ats, attempted };
  if (attempted.finetuned) response.finetuned = settle(finetuned);
  if (attempted.baseline) response.baseline = settle(baseline);
  if (attempted.claude) response.claude = settle(claude);

  return NextResponse.json(response);
}

const SKIP = Symbol("skipped");
function skipped(): Promise<never> {
  return Promise.reject(SKIP);
}

function settle<T>(outcome: PromiseSettledResult<T>): EngineOutcome<T> {
  if (outcome.status === "fulfilled") return { ok: true, value: outcome.value };
  return { ok: false, ...describe(outcome.reason) };
}

function describe(reason: unknown): { error: string; message: string } {
  if (reason === SKIP) return { error: "NOT_CONFIGURED", message: "Engine not configured." };
  if (reason instanceof AnalyzeError) return { error: reason.code, message: reason.message };
  if (reason instanceof MissingEnvError) return { error: "CONFIG_ERROR", message: reason.message };
  return {
    error: "PROVIDER_ERROR",
    message: reason instanceof Error ? reason.message : "Unknown failure.",
  };
}
