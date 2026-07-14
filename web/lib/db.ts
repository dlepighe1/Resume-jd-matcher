import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { AnalysisResult, ProviderId } from "@/lib/types";

export interface StoredAnalysis {
  id: string;
  createdAt: string;
  jobDescription: string;
  resumeText: string;
  result: AnalysisResult;
  isPublic: boolean;
}

/**
 * Supabase is optional. Without it the app still analyzes — it just can't offer a
 * shareable link. Checked by reading process.env directly rather than through the env
 * getters, because those throw by design and "not configured" is not an error here.
 */
export function isPersistenceConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

/** Service-role client. Bypasses RLS, so it must never be constructed client-side. */
function serverClient() {
  return createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Persist an analysis and return its id.
 *
 * Returns null instead of throwing when the write fails: the user already has their
 * analysis, and losing the ability to *share* it is not a reason to throw away a result
 * we spent an API call and several seconds producing.
 */
export async function saveAnalysis(input: {
  jobDescription: string;
  resumeText: string;
  provider: ProviderId;
  result: AnalysisResult;
}): Promise<string | null> {
  try {
    const { data, error } = await serverClient()
      .from("analyses")
      .insert({
        job_description: input.jobDescription,
        resume_text: input.resumeText,
        provider: input.provider,
        model_id: input.result.meta.modelId,
        result_json: input.result,
        latency_ms: input.result.meta.latencyMs,
        is_public: false, // private until the user explicitly shares it
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to persist analysis:", error.message);
      return null;
    }
    return data.id as string;
  } catch (error) {
    console.error("Failed to persist analysis:", error);
    return null;
  }
}

/** Read a shared analysis. Returns null for a private or missing row — the caller 404s
 *  either way, so a private id is indistinguishable from one that never existed. */
export async function getSharedAnalysis(id: string): Promise<StoredAnalysis | null> {
  const { data, error } = await serverClient()
    .from("analyses")
    .select("id, created_at, job_description, resume_text, result_json, is_public")
    .eq("id", id)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    createdAt: data.created_at,
    jobDescription: data.job_description,
    resumeText: data.resume_text,
    result: data.result_json as AnalysisResult,
    isPublic: data.is_public,
  };
}

/** Flip a private row to public. This is the only way a resume becomes world-readable. */
export async function publishAnalysis(id: string): Promise<boolean> {
  const { error, count } = await serverClient()
    .from("analyses")
    .update({ is_public: true }, { count: "exact" })
    .eq("id", id);

  if (error) {
    console.error("Failed to publish analysis:", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}
