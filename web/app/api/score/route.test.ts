import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The point of this route is engine disagreement, so partial failure is the normal case, not
 * an edge case. If Claude is rate limited you must still see what the fine-tuned model said.
 *
 * These tests exist because that guarantee is easy to break by accident: swapping allSettled
 * for all, or letting one adapter's throw escape the handler, would collapse three answers
 * into one error page and nothing else in the suite would notice.
 *
 * Every dependency is stubbed. No network, no API key, no model.
 */
vi.mock("@/lib/providers/finetuned", () => ({ analyzeWithFineTuned: vi.fn() }));
vi.mock("@/lib/providers/baseline", () => ({ scoreWithBaseModel: vi.fn() }));
vi.mock("@/lib/providers/claude", () => ({ analyzeWithClaude: vi.fn() }));

import { scoreWithBaseModel } from "@/lib/providers/baseline";
import { analyzeWithClaude } from "@/lib/providers/claude";
import { analyzeWithFineTuned } from "@/lib/providers/finetuned";
import { AnalyzeError } from "@/lib/errors";
import { POST } from "./route";

const WORDS = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");

function request(body: unknown) {
  return new Request("http://localhost/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = { jobDescription: WORDS, resumeText: WORDS };

const analysis = (score: number) => ({
  matchScore: score,
  matchedSkills: ["python"],
  missingSkills: ["airflow"],
  strengths: ["built pipelines"],
  meta: { provider: "finetuned" as const, modelId: "stub", latencyMs: 1, calibrated: true },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SCORING_SERVICE_URL = "http://localhost:8000";
  delete process.env.ANTHROPIC_API_KEY;
});

describe("POST /api/score", () => {
  it("returns every configured engine's result for one pair", async () => {
    vi.mocked(analyzeWithFineTuned).mockResolvedValue(analysis(82));
    vi.mocked(scoreWithBaseModel).mockResolvedValue({
      rawCosine: 0.61,
      modelId: "all-mpnet-base-v2",
      calibrated: false,
    });

    const res = await POST(request(validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.finetuned.ok).toBe(true);
    expect(body.finetuned.value.matchScore).toBe(82);
    expect(body.baseline.ok).toBe(true);
    expect(body.baseline.value.rawCosine).toBe(0.61);
  });

  it("keeps the surviving engines when one fails", async () => {
    vi.mocked(analyzeWithFineTuned).mockResolvedValue(analysis(82));
    vi.mocked(scoreWithBaseModel).mockRejectedValue(
      new AnalyzeError("MODEL_SERVICE_UNREACHABLE", "service asleep", 503),
    );

    const body = await (await POST(request(validBody))).json();

    expect(body.finetuned.ok).toBe(true);
    expect(body.baseline.ok).toBe(false);
    expect(body.baseline.error).toBe("MODEL_SERVICE_UNREACHABLE");
    expect(body.baseline.message).toContain("service asleep");
  });

  it("still returns 200 when every engine fails, so the client can explain each failure", async () => {
    vi.mocked(analyzeWithFineTuned).mockRejectedValue(new Error("boom"));
    vi.mocked(scoreWithBaseModel).mockRejectedValue(new Error("boom"));

    const res = await POST(request(validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.finetuned.ok).toBe(false);
    expect(body.baseline.ok).toBe(false);
    expect(body.ats).toBeDefined();
  });

  it("omits Claude unless it is both requested and configured", async () => {
    vi.mocked(analyzeWithFineTuned).mockResolvedValue(analysis(70));
    vi.mocked(scoreWithBaseModel).mockResolvedValue({
      rawCosine: 0.5,
      modelId: "base",
      calibrated: false,
    });

    const noKey = await (await POST(request({ ...validBody, includeClaude: true }))).json();
    expect(noKey.attempted.claude).toBe(false);
    expect(noKey.claude).toBeUndefined();
    expect(analyzeWithClaude).not.toHaveBeenCalled();

    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const notRequested = await (await POST(request(validBody))).json();
    expect(notRequested.attempted.claude).toBe(false);
    expect(analyzeWithClaude).not.toHaveBeenCalled();
  });

  it("calls Claude when requested and configured", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.mocked(analyzeWithFineTuned).mockResolvedValue(analysis(70));
    vi.mocked(scoreWithBaseModel).mockResolvedValue({
      rawCosine: 0.5,
      modelId: "base",
      calibrated: false,
    });
    vi.mocked(analyzeWithClaude).mockResolvedValue({ ...analysis(64), summary: "reasonable fit" });

    const body = await (await POST(request({ ...validBody, includeClaude: true }))).json();

    expect(body.attempted.claude).toBe(true);
    expect(body.claude.ok).toBe(true);
    expect(body.claude.value.summary).toBe("reasonable fit");
  });

  it("skips the model engines entirely when the service is not configured", async () => {
    delete process.env.SCORING_SERVICE_URL;

    const body = await (await POST(request(validBody))).json();

    expect(body.attempted.finetuned).toBe(false);
    expect(body.attempted.baseline).toBe(false);
    expect(analyzeWithFineTuned).not.toHaveBeenCalled();
    // Keyword coverage is pure text analysis, so it works with no engine at all.
    expect(body.ats).toBeDefined();
  });

  it("rejects inputs too short to score meaningfully", async () => {
    const res = await POST(request({ jobDescription: "too short", resumeText: WORDS }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("TOO_SHORT");
    expect(analyzeWithFineTuned).not.toHaveBeenCalled();
  });

  it("rejects a malformed body without reaching any engine", async () => {
    const res = await POST(
      new Request("http://localhost/api/score", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_REQUEST");
    expect(analyzeWithFineTuned).not.toHaveBeenCalled();
  });

  it("computes keyword coverage once, independently of any engine", async () => {
    vi.mocked(analyzeWithFineTuned).mockResolvedValue(analysis(82));
    vi.mocked(scoreWithBaseModel).mockResolvedValue({
      rawCosine: 0.6,
      modelId: "base",
      calibrated: false,
    });

    const jd = `We need someone with Python and SQL and Airflow experience. ${WORDS}`;
    const resume = `I have used Python and SQL extensively in production. ${WORDS}`;
    const body = await (await POST(request({ jobDescription: jd, resumeText: resume }))).json();

    // Airflow appears in the posting and not in the resume, so it must surface as a gap.
    expect(body.ats.missing).toContain("airflow");
    expect(body.ats.matched).toEqual(expect.arrayContaining(["python", "sql"]));
  });
});
