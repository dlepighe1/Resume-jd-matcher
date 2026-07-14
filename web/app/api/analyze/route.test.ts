import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/analyze/route";

const LONG = "word ".repeat(60);

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("request validation", () => {
  it("rejects a non-JSON body", async () => {
    const response = await post("not json at all");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_REQUEST" });
  });

  it("rejects an unknown provider", async () => {
    const response = await post({
      jobDescription: LONG,
      resumeText: LONG,
      provider: "gpt-9",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_REQUEST" });
  });

  it("refuses a too-short job description", async () => {
    const response = await post({
      jobDescription: "Python dev wanted.",
      resumeText: LONG,
      provider: "claude",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("TOO_SHORT");
    expect(body.message).toContain("job description");
  });

  it("refuses a too-short resume", async () => {
    const response = await post({
      jobDescription: LONG,
      resumeText: "I know Python.",
      provider: "claude",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "TOO_SHORT" });
  });
});

describe("provider dispatch", () => {
  it("returns the provider's result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            score: 0.66,
            raw_cosine: 0.8,
            calibrator: "platt",
            model_id: "test-model",
            coverage: 0.5,
            requirements: [],
          }),
        ),
      ),
    );

    const response = await post({
      jobDescription: LONG,
      resumeText: LONG,
      provider: "finetuned",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.matchScore).toBe(66);
    expect(body.result.meta.provider).toBe("finetuned");
  });

  it("maps a provider failure to its status and echoes Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", { status: 429, headers: { "retry-after": "30" } }),
      ),
    );

    const response = await post({
      jobDescription: LONG,
      resumeText: LONG,
      provider: "openrouter",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toMatchObject({
      error: "RATE_LIMITED",
      retryAfter: 30,
    });
  });

  it("reports a missing API key as an operator config problem", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");

    const response = await post({
      jobDescription: LONG,
      resumeText: LONG,
      provider: "openrouter",
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("CONFIG_ERROR");
    expect(body.message).toContain("OPENROUTER_API_KEY");
  });
});

describe("persistence", () => {
  function stubScoringService() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            score: 0.66,
            raw_cosine: 0.8,
            calibrator: "platt",
            model_id: "test-model",
            coverage: 0.5,
            requirements: [],
          }),
        ),
      ),
    );
  }

  it("still returns the analysis when Supabase is not configured", async () => {
    // SUPABASE_URL is absent from the test env, so persistence is off. Losing the
    // ability to *share* a result must never cost the user the result itself.
    stubScoringService();

    const response = await post({
      jobDescription: LONG,
      resumeText: LONG,
      provider: "finetuned",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.matchScore).toBe(66);
    expect(body.id).toBeNull(); // no id -> the UI hides the Share affordance
  });
});
