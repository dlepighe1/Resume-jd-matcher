import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@supabase/supabase-js";

import { getSharedAnalysis, isPersistenceConfigured, saveAnalysis } from "@/lib/db";
import type { AnalysisResult } from "@/lib/types";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const RESULT: AnalysisResult = {
  matchScore: 72,
  matchedSkills: ["Python"],
  missingSkills: ["Kubernetes"],
  strengths: ["Built Airflow DAGs"],
  meta: { provider: "finetuned", modelId: "test-model", latencyMs: 900, calibrated: true },
};

/** Records the query the code builds, so we can assert on the filters it applies —
 *  which is where the privacy guarantee actually lives. */
function stubSupabase(rowResult: { data: unknown; error: unknown } = { data: null, error: null }) {
  const calls: { insert?: Record<string, unknown>; eq: Array<[string, unknown]> } = { eq: [] };

  const chain: Record<string, unknown> = {
    insert: (payload: Record<string, unknown>) => {
      calls.insert = payload;
      return chain;
    },
    select: () => chain,
    update: () => chain,
    eq: (column: string, value: unknown) => {
      calls.eq.push([column, value]);
      return chain;
    },
    single: async () => rowResult,
    maybeSingle: async () => rowResult,
  };

  vi.mocked(createClient).mockReturnValue({ from: () => chain } as never);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
});

describe("isPersistenceConfigured", () => {
  it("is false when Supabase env vars are absent, without throwing", () => {
    vi.stubEnv("SUPABASE_URL", "");

    // The env getters throw by design; "not configured" is a normal state, not an error.
    expect(() => isPersistenceConfigured()).not.toThrow();
    expect(isPersistenceConfigured()).toBe(false);
  });
});

describe("saveAnalysis", () => {
  it("stores new analyses PRIVATE — a resume is never world-readable by default", async () => {
    const calls = stubSupabase({ data: { id: "row-id" }, error: null });

    await saveAnalysis({
      jobDescription: "jd",
      resumeText: "resume",
      provider: "finetuned",
      result: RESULT,
    });

    expect(calls.insert?.is_public).toBe(false);
  });

  it("records the exact model id, so a stored result stays reproducible", async () => {
    const calls = stubSupabase({ data: { id: "row-id" }, error: null });

    await saveAnalysis({
      jobDescription: "jd",
      resumeText: "resume",
      provider: "finetuned",
      result: RESULT,
    });

    expect(calls.insert?.model_id).toBe("test-model");
  });

  it("returns null rather than throwing when the write fails", async () => {
    // The user already has their analysis. Losing the shareable link is not a reason to
    // throw away a result that cost an API call and several seconds.
    stubSupabase({ data: null, error: { message: "connection refused" } });

    const id = await saveAnalysis({
      jobDescription: "jd",
      resumeText: "resume",
      provider: "finetuned",
      result: RESULT,
    });

    expect(id).toBeNull();
  });
});

describe("getSharedAnalysis", () => {
  it("only ever reads rows that were explicitly shared", async () => {
    const calls = stubSupabase({ data: null, error: null });

    await getSharedAnalysis("3f2a7c1e-9b4d-4e2a-8f11-2c6d5e7a9b30");

    // Without this filter, anyone holding an id could read a private resume.
    expect(calls.eq).toContainEqual(["is_public", true]);
  });

  it("returns null for a private or missing row", async () => {
    stubSupabase({ data: null, error: null });

    await expect(
      getSharedAnalysis("3f2a7c1e-9b4d-4e2a-8f11-2c6d5e7a9b30"),
    ).resolves.toBeNull();
  });
});
