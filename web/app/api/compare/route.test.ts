import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/compare/route";
import { AnalyzeError } from "@/lib/errors";
import { providers } from "@/lib/providers";
import { resetRateLimits } from "@/lib/rate-limit";
import type { AnalysisResult, ProviderId } from "@/lib/types";

vi.mock("@/lib/providers", () => ({
  providers: { finetuned: vi.fn(), claude: vi.fn(), openrouter: vi.fn() },
}));

const LONG = "word ".repeat(60);

function resultFor(provider: ProviderId, matchScore: number): AnalysisResult {
  return {
    matchScore,
    matchedSkills: [],
    missingSkills: ["Kubernetes"],
    strengths: [],
    meta: { provider, modelId: `${provider}-model`, latencyMs: 100, calibrated: false },
  };
}

function compare(body: unknown = { jobDescription: LONG, resumeText: LONG }) {
  return POST(
    new Request("http://localhost/api/compare", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-forwarded-for": "203.0.113.7" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(providers.finetuned).mockResolvedValue(resultFor("finetuned", 71));
  vi.mocked(providers.claude).mockResolvedValue(resultFor("claude", 78));
  vi.mocked(providers.openrouter).mockResolvedValue(resultFor("openrouter", 65));
});

afterEach(() => resetRateLimits());

describe("fan-out", () => {
  it("runs every engine and returns all three outcomes", async () => {
    const body = await (await compare()).json();

    expect(body.results.finetuned).toEqual({ ok: true, result: resultFor("finetuned", 71) });
    expect(body.results.claude.result.matchScore).toBe(78);
    expect(body.results.openrouter.result.matchScore).toBe(65);
  });

  it("keeps the working engines when one fails", async () => {
    // The entire point of a comparison view: Claude being rate limited must not blank
    // out the fine-tuned result the user actually came to see.
    vi.mocked(providers.claude).mockRejectedValue(
      new AnalyzeError("RATE_LIMITED", "Claude is rate limiting this key.", 429, 30),
    );

    const response = await compare();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.claude).toEqual({
      ok: false,
      error: "RATE_LIMITED",
      message: "Claude is rate limiting this key.",
    });
    expect(body.results.finetuned.ok).toBe(true);
    expect(body.results.openrouter.ok).toBe(true);
  });

  it("survives every engine failing", async () => {
    const boom = new AnalyzeError("PROVIDER_ERROR", "down", 502);
    vi.mocked(providers.finetuned).mockRejectedValue(boom);
    vi.mocked(providers.claude).mockRejectedValue(boom);
    vi.mocked(providers.openrouter).mockRejectedValue(boom);

    const response = await compare();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.values(body.results).every((o) => (o as { ok: boolean }).ok === false)).toBe(true);
  });

  it("refuses texts that are too short", async () => {
    const response = await compare({ jobDescription: "short", resumeText: LONG });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "TOO_SHORT" });
    expect(providers.claude).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("rejects once the per-minute limit is exceeded", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");

    expect((await compare()).status).toBe(200);
    expect((await compare()).status).toBe(200);

    const third = await compare();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThan(0);

    vi.unstubAllEnvs();
  });

  it("does not run any model once rate limited", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "1");

    await compare();
    vi.clearAllMocks();
    await compare(); // over the limit

    expect(providers.claude).not.toHaveBeenCalled();
    expect(providers.finetuned).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});
