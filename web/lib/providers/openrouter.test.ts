import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzeError } from "@/lib/errors";
import { analyzeWithOpenRouter } from "@/lib/providers/openrouter";

const JD = "a ".repeat(60);
const RESUME = "b ".repeat(60);

const VALID = {
  matchScore: 72,
  summary: "Strong on the data-engineering core.",
  matchedSkills: ["Python and SQL"],
  missingSkills: ["Kubernetes"],
  strengths: ["Built 40+ Airflow DAGs"],
  suggestedBullets: ["Built and operated 40+ Airflow DAGs processing 2TB daily."],
};

/** Stub one OpenRouter chat completion. */
function reply(content: string, init: { status?: number; headers?: HeadersInit } = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("response parsing", () => {
  it("parses a bare JSON object", async () => {
    mockFetch(reply(JSON.stringify(VALID)));

    const result = await analyzeWithOpenRouter(JD, RESUME);

    expect(result.matchScore).toBe(72);
    expect(result.missingSkills).toEqual(["Kubernetes"]);
    expect(result.meta.provider).toBe("openrouter");
    expect(result.meta.calibrated).toBe(false);
  });

  it("parses JSON wrapped in markdown fences", async () => {
    mockFetch(reply("```json\n" + JSON.stringify(VALID) + "\n```"));

    const result = await analyzeWithOpenRouter(JD, RESUME);

    expect(result.matchScore).toBe(72);
  });

  it("parses JSON buried in prose", async () => {
    mockFetch(reply(`Sure! Here is the analysis you asked for:\n\n${JSON.stringify(VALID)}\n\nHope that helps!`));

    const result = await analyzeWithOpenRouter(JD, RESUME);

    expect(result.matchScore).toBe(72);
  });

  it("does not truncate on a closing brace inside a string value", async () => {
    // The naive regex approach (/\{.*\}/) breaks here — a brace in the summary text
    // ends the match early and the JSON never parses.
    const tricky = { ...VALID, summary: "Uses a closing brace } in the prose. Odd, but legal." };
    mockFetch(reply(JSON.stringify(tricky)));

    const result = await analyzeWithOpenRouter(JD, RESUME);

    expect(result.summary).toContain("closing brace }");
  });

  it("clamps an out-of-range score", async () => {
    mockFetch(reply(JSON.stringify({ ...VALID, matchScore: 140 })));

    const result = await analyzeWithOpenRouter(JD, RESUME);

    expect(result.matchScore).toBe(100);
  });
});

describe("repair retry", () => {
  it("retries once with the validation error and succeeds", async () => {
    const fetchMock = mockFetch(
      reply("I'd be happy to help! Let me analyze..."), // no JSON at all
      reply(JSON.stringify(VALID)),
    );

    const result = await analyzeWithOpenRouter(JD, RESUME);

    expect(result.matchScore).toBe(72);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The repair turn must tell the model what was actually wrong — a bare "try again"
    // reliably produces the same broken output a second time.
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const repairPrompt = secondBody.messages.at(-1).content;
    expect(repairPrompt).toContain("no JSON object found");
    expect(secondBody.messages.at(-2).role).toBe("assistant");
  });

  it("names the offending field when the schema does not match", async () => {
    const fetchMock = mockFetch(
      reply(JSON.stringify({ ...VALID, matchScore: "seventy-two" })),
      reply(JSON.stringify(VALID)),
    );

    await analyzeWithOpenRouter(JD, RESUME);

    const repairPrompt = JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1).content;
    expect(repairPrompt).toContain("matchScore");
  });

  it("gives up after one failed repair", async () => {
    const fetchMock = mockFetch(reply("no json here"), reply("still no json"));

    await expect(analyzeWithOpenRouter(JD, RESUME)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("upstream errors", () => {
  it("surfaces a rate limit with its retry-after", async () => {
    mockFetch(reply("", { status: 429, headers: { "retry-after": "45" } }));

    const error = await analyzeWithOpenRouter(JD, RESUME).catch((e) => e);

    expect(error).toBeInstanceOf(AnalyzeError);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfter).toBe(45);
  });

  it("reports a bad key as a config problem, not a provider failure", async () => {
    mockFetch(new Response("unauthorized", { status: 401 }));

    await expect(analyzeWithOpenRouter(JD, RESUME)).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      status: 500,
    });
  });

  it("reports an empty completion", async () => {
    mockFetch(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    await expect(analyzeWithOpenRouter(JD, RESUME)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });
});
