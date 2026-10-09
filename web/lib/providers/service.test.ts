import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeWithFineTuned } from "@/lib/providers/finetuned";
import { scoreWithBaseModel } from "@/lib/providers/baseline";
import { serviceHeaders } from "@/lib/providers/service";

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
