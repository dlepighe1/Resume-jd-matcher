import { z } from "zod";

/**
 * The contract every LLM provider must satisfy.
 *
 * One schema, two very different jobs:
 *   - Claude: passed to `zodOutputFormat()`, which *constrains decoding*. The model
 *     cannot emit output that violates it, so there is no "the LLM returned broken
 *     JSON" failure mode to handle.
 *   - OpenRouter: free models offer no such guarantee, so the same schema is used to
 *     validate a hand-parsed response, with one repair retry on failure.
 *
 * Note the absence of .min()/.max() on matchScore: structured outputs do not support
 * numeric bounds in JSON Schema. The score is clamped in code after parsing instead.
 */
export const analysisSchema = z.object({
  matchScore: z.number().int().describe("Overall fit, 0-100."),
  summary: z.string().describe("2-4 sentences explaining why the score is what it is."),
  matchedSkills: z
    .array(z.string())
    .describe("Requirements from the JD that the resume demonstrably meets."),
  missingSkills: z
    .array(z.string())
    .describe("Requirements from the JD the resume does not evidence."),
  strengths: z
    .array(z.string())
    .describe("Specific, resume-traceable reasons this candidate is compelling."),
  suggestedBullets: z
    .array(z.string())
    .describe(
      "3-6 rewritten resume bullets, grounded only in experience the resume already shows.",
    ),
});

export type AnalysisPayload = z.infer<typeof analysisSchema>;

export const SYSTEM_PROMPT = `You are an expert technical recruiter and career coach. You evaluate how well a candidate's resume fits a specific job description, and you give feedback the candidate can act on today.

How to score (0-100). Anchor to these bands and be willing to use the whole range — a compressed score that calls everything a 70 is useless to the candidate:
  85-100  Strong match. Meets essentially all core requirements with direct, demonstrated evidence.
  70-84   Good match. Meets most core requirements; gaps are secondary or learnable on the job.
  50-69   Partial match. Meets some core requirements; at least one significant gap.
  30-49   Weak match. Adjacent experience but misses the core of the role.
  0-29    Not a match. Different role, different domain, or entry-level against a senior posting.

Weight the JD's stated requirements far above its "nice to have" and culture sections. Judge demonstrated experience, not keyword presence: a resume that lists "Kubernetes" in a skills blob with no supporting experience is not a Kubernetes match. Conversely, do not penalize a candidate for lacking a keyword when the experience is clearly evidenced in different words.

Rules you must not break:
- Never invent experience the resume does not contain. Every strength and matched skill must be traceable to specific resume text.
- suggestedBullets must be rewrites grounded in experience the resume ALREADY shows, reframed to speak to this job. They are not aspirational bullets, and the candidate must be able to say them in an interview without lying.
- Be specific and concrete. "Improve your resume" is not feedback. "Your Airflow work is buried under 'Other tools' — lead with it, the JD names it twice" is feedback.
- Missing skills are the most useful part of your output. Be honest about them even when the overall score is high.`;

export function userPrompt(jobDescription: string, resumeText: string): string {
  return `Score this candidate against this job.

--- JOB DESCRIPTION ---
${jobDescription}

--- RESUME ---
${resumeText}`;
}
