/** Shared types for the analyzer. Kept free of server-only imports so client
 *  components can use them too. */

import type { AtsAnalysis } from "@/lib/ats";

export const PROVIDERS = ["finetuned", "claude", "openrouter"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/**
 * What a provider can actually produce.
 *
 * This exists because the three engines are genuinely not interchangeable: the
 * fine-tuned model is a sentence-transformer, so it can score a pair and locate
 * skill gaps, but it cannot write prose. The UI reads these flags and hides what
 * a provider can't do, rather than rendering an empty "Suggested bullets" panel.
 */
export interface ProviderCapabilities {
  score: boolean;
  skillGap: boolean;
  /** Suggested bullets + summary. LLMs only. */
  generativeFeedback: boolean;
  /** Score is calibrated against labelled data, not just a raw model output. */
  calibrated: boolean;
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  tagline: string;
  capabilities: ProviderCapabilities;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  finetuned: {
    id: "finetuned",
    name: "Fine-tuned MPNet",
    tagline: "Calibrated scorer, externally validated",
    capabilities: { score: true, skillGap: true, generativeFeedback: false, calibrated: true },
  },
  claude: {
    id: "claude",
    name: "Claude",
    tagline: "Full written feedback and tailored bullets",
    capabilities: { score: true, skillGap: true, generativeFeedback: true, calibrated: false },
  },
  openrouter: {
    id: "openrouter",
    name: "Open-weights",
    tagline: "Free model via OpenRouter",
    capabilities: { score: true, skillGap: true, generativeFeedback: true, calibrated: false },
  },
};

export type RequirementStatus = "covered" | "partial" | "missing";

export interface AnalysisResult {
  /** 0-100. */
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  /** LLM providers only. */
  suggestedBullets?: string[];
  /** LLM providers only. */
  summary?: string;
  /**
   * Fine-tuned provider only.
   *
   * NOT a per-pair confidence interval — we have no principled way to compute one for a
   * single prediction. It is the model's *measured* mean absolute error on held-out data,
   * expressed as a band. Saying "72, and this model is typically within ±10 on pairs it
   * has never seen" is a claim the evidence supports. Saying "95% CI 66-78" for one pair
   * would be a number that looks rigorous and isn't.
   */
  errorBand?: { low: number; high: number; basis: string };
  /** Deterministic keyword coverage. Computed for every engine — it is a different
   *  signal from semantic similarity, not a worse one. */
  ats?: AtsAnalysis;
  meta: {
    provider: ProviderId;
    modelId: string;
    latencyMs: number;
    calibrated: boolean;
  };
}

export interface Verdict {
  label: string;
  /** Tailwind classes for the band. Colour is never the only signal — the label
   *  is always rendered alongside it. */
  ring: string;
  text: string;
  chip: string;
}

/**
 * Score bands. These mirror `verdict_band()` in app/explain.py exactly, so the
 * web app and the research code never disagree about what a 0.62 means.
 */
export function verdictFor(score: number): Verdict {
  if (score >= 70)
    return {
      label: "Strong match",
      ring: "stroke-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
      chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20",
    };
  if (score >= 50)
    return {
      label: "Good match",
      ring: "stroke-blue-500",
      text: "text-blue-700 dark:text-blue-400",
      chip: "bg-blue-50 text-blue-800 ring-blue-600/20 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-400/20",
    };
  if (score >= 30)
    return {
      label: "Partial match",
      ring: "stroke-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      chip: "bg-amber-50 text-amber-900 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
    };
  if (score >= 15)
    return {
      label: "Weak match",
      ring: "stroke-orange-500",
      text: "text-orange-700 dark:text-orange-400",
      chip: "bg-orange-50 text-orange-900 ring-orange-600/20 dark:bg-orange-950 dark:text-orange-300 dark:ring-orange-400/20",
    };
  return {
    label: "Not a match",
    ring: "stroke-rose-500",
    text: "text-rose-700 dark:text-rose-400",
    chip: "bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-400/20",
  };
}

/** Both texts need enough signal to score meaningfully — below this we refuse
 *  rather than return a confident-looking number built on nothing. */
export const MIN_WORDS = 50;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
