import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeAtsKeywords } from "@/lib/ats";
import { MissingEnvError } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";
import { providers } from "@/lib/providers";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { MIN_WORDS, PROVIDERS, wordCount, type AnalysisResult, type ProviderId } from "@/lib/types";

export const maxDuration = 120;

const MAX_CHARS = 15_000;

const requestSchema = z.object({
  jobDescription: z.string().max(MAX_CHARS),
  resumeText: z.string().max(MAX_CHARS),
});

export type ComparisonOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; error: string; message: string };

/**
 * Run one pair through all three engines at once.
 *
 * The whole point of this endpoint is disagreement, so a single provider failing must
 * never fail the request — if Claude is rate limited, you should still get to see what
 * the fine-tuned model said. Hence allSettled and a per-provider outcome, rather than
 * Promise.all, which would throw away two good results because a third was unavailable.
 */
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        message: "Too many requests. Comparison runs three models at once.",
        retryAfter: limit.retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

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

  const { jobDescription, resumeText } = parsed.data;
  if (wordCount(jobDescription) < MIN_WORDS || wordCount(resumeText) < MIN_WORDS) {
    return NextResponse.json(
      { error: "TOO_SHORT", message: `Both texts need at least ${MIN_WORDS} words.` },
      { status: 400 },
    );
  }

  const settled = await Promise.allSettled(
    PROVIDERS.map((id) => providers[id](jobDescription, resumeText)),
  );

  // Identical for every engine — it's a property of the texts, not of the model.
  const ats = analyzeAtsKeywords(jobDescription, resumeText) ?? undefined;

  const results = {} as Record<ProviderId, ComparisonOutcome>;
  PROVIDERS.forEach((id, index) => {
    const outcome = settled[index];
    results[id] =
      outcome.status === "fulfilled"
        ? { ok: true, result: { ...outcome.value, ats } }
        : { ok: false, ...describe(outcome.reason) };
  });

  return NextResponse.json({ results, ats });
}

function describe(reason: unknown): { error: string; message: string } {
  if (reason instanceof AnalyzeError) return { error: reason.code, message: reason.message };
  if (reason instanceof MissingEnvError) {
    return { error: "CONFIG_ERROR", message: reason.message };
  }
  return {
    error: "PROVIDER_ERROR",
    message: reason instanceof Error ? reason.message : "Unknown failure.",
  };
}
