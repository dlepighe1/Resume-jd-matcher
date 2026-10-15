import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeWithFineTuned } from "@/lib/providers/finetuned";
import { scoreWithBaseModel } from "@/lib/providers/baseline";
import { serviceHeaders, serviceRetry } from "@/lib/providers/service";

afterEach(() => {
  delete process.env.SCORING_SERVICE_SECRET;
  vi.unstubAllGlobals();
});

describe("headers sent to the scoring service", () => {
  it("forwards the visitor's address alongside the shared secret", () => {
    process.env.SCORING_SERVICE_SECRET = "s3cret";

    expect(serviceHeaders("1.2.3.4")).toEqual({
      "Content-Type": "application/json",
      "X-Proxy-Secret": "s3cret",
      "X-Client-IP": "1.2.3.4",
    });
  });

  it("forwards nothing when no secret is configured, since the service would ignore it", () => {
    expect(serviceHeaders("1.2.3.4")).toEqual({ "Content-Type": "application/json" });
  });

  it("forwards nothing when the visitor's address is unknown", () => {
    process.env.SCORING_SERVICE_SECRET = "s3cret";

    expect(serviceHeaders(undefined)).toEqual({ "Content-Type": "application/json" });
  });

  it("is what both providers actually send", async () => {
    process.env.SCORING_SERVICE_SECRET = "s3cret";
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ score: 0.5, raw_cosine: 0.5, calibrator: null, model_id: "m",
          requirements: [], coverage: 0 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await analyzeWithFineTuned("jd", "resume", "1.2.3.4");
    await scoreWithBaseModel("jd", "resume", "1.2.3.4");

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers).toMatchObject({ "X-Client-IP": "1.2.3.4" });
    }
  });
});

describe("waking the scoring service", () => {
  const defaults = { ...serviceRetry };
  const SCORE = { score: 0.5, raw_cosine: 0.5, calibrator: null, model_id: "m",
    requirements: [], coverage: 0 };

  afterEach(() => Object.assign(serviceRetry, defaults));

  function respondWith(...statuses: number[]) {
    const fetchMock = vi.fn();
    for (const status of statuses) {
      fetchMock.mockResolvedValueOnce(
        new Response(status === 200 ? JSON.stringify(SCORE) : "Application failed to respond",
          { status }),
      );
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("retries through the 502 a host returns while the container starts, then the 503 while the model loads", async () => {
    Object.assign(serviceRetry, { budgetMs: 1_000, backoffMs: [1] });
    const fetchMock = respondWith(502, 503, 200);

    const result = await analyzeWithFineTuned("jd", "resume");

    expect(result.matchScore).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does the same for the baseline", async () => {
    Object.assign(serviceRetry, { budgetMs: 1_000, backoffMs: [1] });
    respondWith(502, 200);

    await expect(scoreWithBaseModel("jd", "resume")).resolves.toMatchObject({ rawCosine: 0.5 });
  });

  it("gives up with the last status once the budget is spent", async () => {
    Object.assign(serviceRetry, { budgetMs: 0, backoffMs: [1] });
    respondWith(502, 200);

    await expect(analyzeWithFineTuned("jd", "resume")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: expect.stringContaining("502"),
    });
  });

  it("never retries a rate limit or a bad request", async () => {
    Object.assign(serviceRetry, { budgetMs: 1_000, backoffMs: [1] });
    const fetchMock = respondWith(429, 200);

    await expect(analyzeWithFineTuned("jd", "resume")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finishes inside the route's maxDuration, so Vercel never answers with a bare 504", async () => {
    const { maxDuration } = await import("@/app/api/score/route");

    expect(defaults.budgetMs).toBeLessThan(maxDuration * 1_000);
  });
});
