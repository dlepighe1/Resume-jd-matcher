import { analyzeWithClaude } from "@/lib/providers/claude";
import { analyzeWithFineTuned } from "@/lib/providers/finetuned";
import { analyzeWithOpenRouter } from "@/lib/providers/openrouter";
import type { AnalysisResult, ProviderId } from "@/lib/types";

type AnalyzeFn = (jobDescription: string, resumeText: string) => Promise<AnalysisResult>;

/** All three engines behind one signature, so /api/analyze and the future /api/compare
 *  fan-out never need to know which is which. */
export const providers: Record<ProviderId, AnalyzeFn> = {
  claude: analyzeWithClaude,
  openrouter: analyzeWithOpenRouter,
  finetuned: analyzeWithFineTuned,
};
