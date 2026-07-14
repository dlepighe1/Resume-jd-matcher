import { env } from "@/lib/env";
import { AnalyzeError } from "@/lib/errors";
import { SYSTEM_PROMPT, analysisSchema, userPrompt, type AnalysisPayload } from "@/lib/schema";
import { PROVIDER_META, type AnalysisResult } from "@/lib/types";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 90_000;

/**
 * The path where "handle malformed JSON" is a real requirement.
 *
 * Claude constrains decoding to the schema, so broken JSON simply cannot come back.
 * Free open-weights models offer no such guarantee: they wrap JSON in prose, fence it
 * in markdown, or drop a field. So here we ask for JSON, extract it, validate against
 * the same Zod schema, and — if that fails — hand the model its own validation error
 * and let it fix the output once before giving up.
 */
export async function analyzeWithOpenRouter(
  jobDescription: string,
  resumeText: string,
): Promise<AnalysisResult> {
  const apiKey = env.openrouter.apiKey;
  const modelId = env.openrouter.model;
  const startedAt = Date.now();

  const messages = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_INSTRUCTION}` },
    { role: "user", content: userPrompt(jobDescription, resumeText) },
  ];

  let raw = await callOpenRouter(apiKey, modelId, messages);
  let parsed = tryParse(raw);

  if (!parsed.ok) {
    // One repair attempt. Show the model exactly what it got wrong — a bare "that was
    // invalid, try again" tends to produce the same broken output a second time.
    messages.push(
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `That response could not be parsed: ${parsed.error}\n\nReturn ONLY the corrected JSON object. No markdown fences, no commentary.`,
      },
    );
    raw = await callOpenRouter(apiKey, modelId, messages);
    parsed = tryParse(raw);
  }

  if (!parsed.ok) {
    throw new AnalyzeError(
      "INVALID_OUTPUT",
      `${modelId} did not return valid JSON, even after a repair attempt (${parsed.error}). Free models are unreliable at structured output — try Claude for this pair.`,
      502,
    );
  }

  const payload = parsed.value;
  return {
    matchScore: Math.max(0, Math.min(100, Math.round(payload.matchScore))),
    matchedSkills: payload.matchedSkills,
    missingSkills: payload.missingSkills,
    strengths: payload.strengths,
    suggestedBullets: payload.suggestedBullets,
    summary: payload.summary,
    meta: {
      provider: "openrouter",
      modelId,
      latencyMs: Date.now() - startedAt,
      calibrated: PROVIDER_META.openrouter.capabilities.calibrated,
    },
  };
}

const JSON_INSTRUCTION = `Respond with a single JSON object and nothing else. No markdown fences, no explanation before or after it. It must have exactly these keys:
{
  "matchScore": <integer 0-100>,
  "summary": "<2-4 sentences>",
  "matchedSkills": ["<requirement the resume meets>", ...],
  "missingSkills": ["<requirement the resume does not evidence>", ...],
  "strengths": ["<specific, resume-traceable reason>", ...],
  "suggestedBullets": ["<rewritten bullet grounded in existing experience>", ...]
}`;

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, max_tokens: 2048 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AnalyzeError(
      "PROVIDER_ERROR",
      timedOut
        ? `${model} did not respond within ${TIMEOUT_MS / 1000}s. Free models are often queued behind paid traffic.`
        : "Could not reach OpenRouter.",
      502,
    );
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after")) || 60;
    throw new AnalyzeError(
      "RATE_LIMITED",
      "OpenRouter is rate limiting this key. Free-tier models have tight limits.",
      429,
      retryAfter,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AnalyzeError(
      response.status === 401 ? "CONFIG_ERROR" : "PROVIDER_ERROR",
      response.status === 401
        ? "OpenRouter rejected the API key. Check OPENROUTER_API_KEY."
        : `OpenRouter returned ${response.status}. ${body.slice(0, 200)}`,
      response.status === 401 ? 500 : 502,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new AnalyzeError("INVALID_OUTPUT", `${model} returned an empty response.`, 502);
  }
  return content;
}

type ParseOutcome =
  | { ok: true; value: AnalysisPayload }
  | { ok: false; error: string };

function tryParse(raw: string): ParseOutcome {
  const json = extractJsonObject(raw);
  if (!json) return { ok: false, error: "no JSON object found in the response" };

  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }

  const result = analysisSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "root"}: ${issue.message}` };
  }
  return { ok: true, value: result.data };
}

/**
 * Pull the first complete JSON object out of a response that may be wrapped in prose
 * or markdown fences. Brace-counting rather than a regex, because a regex can't tell
 * a nested closing brace from the final one — and it skips braces inside strings so
 * a `}` in a summary sentence doesn't truncate the object early.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
