import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeAtsKeywords } from "@/lib/ats";
import { isPersistenceConfigured, saveAnalysis } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";
import { providers } from "@/lib/providers";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { MIN_WORDS, PROVIDERS, wordCount } from "@/lib/types";

/** Adaptive thinking plus a cold model service can take a while; the Vercel default
 *  (10s on hobby) would cut a legitimate analysis off mid-flight. */
export const maxDuration = 120;

const MAX_CHARS = 15_000;

const requestSchema = z.object({
  jobDescription: z.string().max(MAX_CHARS),
  resumeText: z.string().max(MAX_CHARS),
  provider: z.enum(PROVIDERS),
  ephemeral: z.boolean().optional(),
});

export async function POST(request: Request) {
  // An unmetered LLM endpoint behind a public URL, with your API key on it, is how you
  // get a surprise bill.
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return fail("RATE_LIMITED", "Too many requests. Slow down a moment.", 429, limit.retryAfter);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_REQUEST", "Request body must be JSON.", 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("INVALID_REQUEST", `${issue.path.join(".") || "body"}: ${issue.message}`, 400);
  }

  const { jobDescription, resumeText, provider } = parsed.data;

  // Enforced server-side as well as in the UI: the client check is a courtesy, not a
  // guarantee, and scoring a 6-word "resume" would produce a confident-looking number
  // with nothing behind it.
  if (wordCount(jobDescription) < MIN_WORDS) {
    return fail("TOO_SHORT", `The job description needs at least ${MIN_WORDS} words.`, 400);
  }
  if (wordCount(resumeText) < MIN_WORDS) {
    return fail("TOO_SHORT", `The resume needs at least ${MIN_WORDS} words.`, 400);
  }

  try {
    const analysis = await providers[provider](jobDescription, resumeText);

    // Keyword coverage runs for every engine, because it answers a question none of them
    // do: an ATS filters on literal strings, so a resume can be a perfect semantic match
    // and still be binned for saying "orchestration tooling" where the JD says "Airflow".
    const result = {
      ...analysis,
      ats: analyzeAtsKeywords(jobDescription, resumeText) ?? undefined,
    };

    // Persistence is optional and best-effort. If Supabase isn't configured, or the
    // insert fails, the user still gets their analysis — they just don't get a
    // shareable link. `ephemeral` opts out entirely: nothing is written at all.
    const shouldPersist = !parsed.data.ephemeral && isPersistenceConfigured();
    const id = shouldPersist
      ? await saveAnalysis({ jobDescription, resumeText, provider, result })
      : null;

    return NextResponse.json({ id, result });
  } catch (error) {
    if (error instanceof AnalyzeError) {
      return fail(error.code, error.message, error.status, error.retryAfter);
    }
    // A missing key is an operator problem, not a user problem — say which one, and
    // don't dress it up as a provider failure.
    if (error instanceof MissingEnvError) {
      return fail("CONFIG_ERROR", error.message, 500);
    }
    console.error("Unhandled analyze error:", error);
    return fail("PROVIDER_ERROR", "Something went wrong running the analysis.", 500);
  }
}

function fail(error: string, message: string, status: number, retryAfter?: number) {
  return NextResponse.json(
    { error, message, ...(retryAfter ? { retryAfter } : {}) },
    {
      status,
      ...(retryAfter ? { headers: { "Retry-After": String(retryAfter) } } : {}),
    },
  );
}
