import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeWithFineTuned } from "@/lib/providers/finetuned";

const JD = "a ".repeat(60);
const RESUME = "b ".repeat(60);

const SCORE_RESPONSE = {
  score: 0.72,
  raw_cosine: 0.81,
  calibrator: "platt",
  model_id: "dlepighe1/resume-jd-matcher-mpnet",
  coverage: 0.5,
  requirements: [
    {
      requirement: "Three years of Python and SQL",
      status: "covered",
      similarity: 0.91,
      evidence: "Built ETL pipelines in Python and SQL.",
    },
    {
      requirement: "Airflow orchestration",
      status: "covered",
      similarity: 0.88,
      evidence: "Built ETL pipelines in Python and SQL.", // duplicate evidence line
    },
    {
      requirement: "Statistics and experimental design",
      status: "partial",
      similarity: 0.42,
      evidence: "Ran some dashboards.",
    },
    {
      requirement: "Kubernetes at scale",
      status: "missing",
      similarity: 0.11,
      evidence: "",
    },
  ],
};

function mockScoreService(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("mapping the scoring service response", () => {
  it("converts the calibrated 0-1 score to 0-100", async () => {
    mockScoreService(SCORE_RESPONSE);

    const result = await analyzeWithFineTuned(JD, RESUME);

    expect(result.matchScore).toBe(72);
    expect(result.meta.calibrated).toBe(true);
    expect(result.meta.modelId).toBe("dlepighe1/resume-jd-matcher-mpnet");
  });

  it("lists only covered requirements as matched", async () => {
    mockScoreService(SCORE_RESPONSE);

    const result = await analyzeWithFineTuned(JD, RESUME);

    expect(result.matchedSkills).toEqual([
      "Three years of Python and SQL",
      "Airflow orchestration",
    ]);
  });

  it("keeps partial coverage in the gap list but labels it distinctly", async () => {
    mockScoreService(SCORE_RESPONSE);

    const result = await analyzeWithFineTuned(JD, RESUME);

    expect(result.missingSkills).toEqual([
      "Kubernetes at scale",
      "Partially covered — Statistics and experimental design",
    ]);
  });

  it("derives strengths from the model's own evidence lines, deduplicated", async () => {
    mockScoreService(SCORE_RESPONSE);

    const result = await analyzeWithFineTuned(JD, RESUME);

    // Two covered requirements matched the same resume sentence — it should appear once.
    expect(result.strengths).toEqual(["Built ETL pipelines in Python and SQL."]);
  });

  it("produces no generative fields — this model cannot write prose", async () => {
    mockScoreService(SCORE_RESPONSE);

    const result = await analyzeWithFineTuned(JD, RESUME);

    expect(result.summary).toBeUndefined();
    expect(result.suggestedBullets).toBeUndefined();
  });

  it("reports uncalibrated when the service has no calibrator loaded", async () => {
    mockScoreService({ ...SCORE_RESPONSE, calibrator: null });

    const result = await analyzeWithFineTuned(JD, RESUME);

    expect(result.meta.calibrated).toBe(false);
  });
});

describe("service failures", () => {
  it("reports an unreachable service distinctly, so the UI can say 'still waking up'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(analyzeWithFineTuned(JD, RESUME)).rejects.toMatchObject({
      code: "MODEL_SERVICE_UNREACHABLE",
      status: 503,
    });
  });

  it("surfaces a 500 from the service as a provider error", async () => {
    mockScoreService({ detail: "model not loaded" }, 500);

    await expect(analyzeWithFineTuned(JD, RESUME)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
