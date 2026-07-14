# AI Resume–Job Match Analyzer — Product Spec, Architecture & Build Plan

**What makes this project different from the 500 other "AI resume matcher" repos:** it doesn't
just call an LLM. It ships a **fine-tuned sentence-transformer with published external-validation
numbers** (Spearman 0.86 / MAE 0.10 on 106 held-out pairs from job postings the model never saw)
and lets you **run the same resume/JD pair through three different engines side by side** —
the fine-tuned scorer, Claude, and a free open-weights model — and see where they disagree.

That comparison *is* the portfolio piece. Anyone can prompt an LLM. Far fewer people can say
"I trained the specialist model, measured it honestly against a general one, and shipped both."

---

# Part 1 — Product Spec & Feature List

## 1.1 MVP Features

### 1. Job Description Input
The user pastes a job posting into a textarea on the landing page (or supplies a URL, which the
server fetches and reduces to text). The client sends the raw string to `POST /api/analyze`;
nothing is parsed client-side. Validation runs on both sides: non-empty, ≥ 50 words, ≤ 15,000
characters — below 50 words there isn't enough signal for a meaningful score, and the UI says so
rather than returning a confidently wrong number. Server-side, the JD is passed through the
**same `smart_truncate_jd` preprocessing the fine-tuned model was trained under** (strip
EEO/benefits/salary boilerplate, prioritize the requirements section, cap at 350 words) so all
three providers see identical input.

### 2. Resume Input
A second textarea, plus optional PDF upload. PDF text extraction happens **server-side** in a
dedicated `POST /api/extract` route (`pdf-parse` or `unpdf`) — never in the browser, so we don't
ship a PDF parser to every visitor. The extracted text is returned to the client and dropped into
the textarea so the user can **see and correct it before analyzing**; silent extraction is how you
get garbage-in-garbage-out with two-column resume layouts. Resume text is capped at 350 words for
the fine-tuned provider (matching training) and passed in full to the LLM providers.

### 3. AI Analysis
The core call. The request carries `{ jobDescription, resumeText, provider }` and returns a single
normalized `AnalysisResult`. For **Claude**, we use the Messages API with
`output_config.format = { type: "json_schema", schema }` — this *constrains decoding* to our schema,
so the "handle malformed JSON" problem largely disappears at the source (see §Prompt Design for why
this changes the error-handling story). For **OpenRouter**, there is no such guarantee, so we
extract the first JSON object, validate with Zod, and retry once with the validation error appended.
For the **fine-tuned model**, there is no JSON generation at all — we get a calibrated cosine score
and a requirement-by-requirement skill gap from embeddings.

### 4. Results Display
A score gauge (0–100, colored by verdict band), the summary paragraph, and four lists: matched
skills, missing skills, strengths, suggested bullets. Each provider declares its **capabilities**,
and the UI renders only what that provider can actually produce — the fine-tuned model returns a
score and skill gap but *cannot* write suggested bullets, and the UI says so explicitly instead of
faking it. Missing skills are the primary CTA (that's the actionable part), so they're rendered
first and expanded by default.

### 5. Error Handling & Loading States
Every failure mode gets a distinct, honest message: rate limit (429 → "try again in Ns", read from
`retry-after`), auth (401 → misconfigured key, log it, don't blame the user), model refusal
(`stop_reason: "refusal"` → surfaced, not retried), schema validation failure after retry, network
timeout, and fine-tuned-service cold start (HF Spaces sleeps — first request can take ~30s, so we
show a "waking the model service" state rather than a spinner that looks hung).

### 6. Shareable Links
On success, the analysis is written to Supabase and the user is redirected to `/results/[id]` —
a public, read-only render of the same results component. The row stores the JD, resume, result
JSON, and which provider produced it. **Privacy is the default**: rows are created with
`is_public = false` and the user must explicitly click "Share" to flip it, because a resume is PII
and silently making it world-readable at a guessable URL is not acceptable. IDs are UUIDs, never
sequential.

## 1.2 Advanced / Resume-Boosting Features

- **Three-engine comparison mode** ⭐ *the headline feature*
  - Run one resume/JD pair through the fine-tuned model, Claude, and the free OpenRouter model
    simultaneously; render the three scores side by side with the deltas highlighted. Show your
    external-validation table next to it so a viewer understands *which* number has evidence behind it.
  - **Complexity: Medium.** Backend: parallel provider fan-out with per-provider error isolation
    (one failing provider must not fail the request). AI: no new prompting. This is the single
    highest-leverage thing on the list — it turns "I used an API" into "I evaluated models."

- **Agreement / disagreement analytics**
  - Log every comparison and chart where the fine-tuned model and the LLMs diverge — by industry,
    seniority, and match type. You already have the finding that cross-encoders collapse on unseen
    JDs; this is the live version of that experiment.
  - **Complexity: Medium.** Backend: aggregate queries. Genuinely novel content for a blog post.

- **ATS keyword optimization score**
  - Deterministic (non-LLM) keyword coverage: extract required skills from the JD, check literal
    and stemmed presence in the resume, report a coverage % and the exact missing terms. Recruiters'
    ATS filters are literal string matchers, so this is a *different and complementary* signal to
    semantic similarity — and it's explainable.
  - **Complexity: Low.** Backend only, no AI. High perceived value, cheap to build.

- **"Rewrite my resume for this job"**
  - Generate a tailored resume version with the missing keywords woven into real experience the
    resume already evidences. Must be constrained hard against fabrication — the prompt forbids
    inventing experience, and every rewritten bullet cites the source bullet it derives from.
  - **Complexity: Medium-High.** Advanced AI usage (multi-step: extract → map → rewrite → verify).
    The anti-fabrication verification pass is what makes this defensible rather than a liability.

- **Multi-resume support + per-JD ranking**
  - Store several resumes; pick one per analysis; or invert it — score *all* your resumes against
    one JD and rank them. You already benchmarked batch ranking at 106 resumes/1.1s on a T4.
  - **Complexity: Medium.** Backend + auth + a batch endpoint on the Python service.

- **Historical dashboard + score trends**
  - Chart match scores over time as the user iterates on their resume. Directly demonstrates whether
    the tool actually *works* — if following the suggestions doesn't raise the score, that's a finding.
  - **Complexity: Medium.** Requires auth and DB aggregation.

- **Role-specific prompt modes**
  - Different system prompts and rubrics per track (Frontend / Data Science / SRE / PM). A "strong
    match" means different things across tracks, and a single generic prompt flattens that.
  - **Complexity: Low.** Prompt templates keyed by an enum; no new infrastructure.

- **Confidence intervals on the score**
  - Report the score as `72% ± 6` using the bootstrap spread you already computed in Notebook 06.
    Almost no consumer AI tool shows uncertainty; showing it is a strong signal of ML maturity.
  - **Complexity: Low** (the numbers exist) **/ Medium** to do it per-request properly.

- **JD URL scraping with graceful fallback**
  - Fetch and reduce a LinkedIn/Indeed/Greenhouse posting to text. Expect to be blocked by the big
    boards — design for it: on failure, fall back cleanly to paste, don't pretend it worked.
  - **Complexity: Medium.** External sites, bot detection, and legal/ToS considerations. Scrape only
    what a user explicitly asks for, and never build a background crawler.

- **Export to PDF / Markdown**
  - Server-rendered PDF of the analysis (score, gaps, suggested bullets) for offline use or sharing
    with a mentor.
  - **Complexity: Low-Medium.** One dependency, one route.

- **Browser extension**
  - Analyze a job posting in-place on LinkedIn/Indeed against a stored resume.
  - **Complexity: High.** Separate build target, extension store review, auth across contexts. High
    demo value, high maintenance cost — do it last, if at all.

- **Privacy / ephemeral mode**
  - A toggle that runs the analysis without persisting anything. Given that the input is a resume,
    this is close to table stakes and is cheap to implement.
  - **Complexity: Low.** Skip the DB write; return the result inline.

- **Rate limiting + abuse protection**
  - Per-IP token bucket (Upstash Redis) on `/api/analyze`. Unmetered LLM endpoints on a public URL
    with your API key behind them are a way to get a surprise bill.
  - **Complexity: Low.** Non-negotiable before you make the URL public.

---

# Part 2 — System Architecture

## 2.1 High-level diagram

```
┌────────────────────────────────────────────────────────────┐
│  Browser — Next.js App Router (React Server + Client)      │
│  /                  paste JD + resume, pick provider       │
│  /results/[id]      read-only shared analysis              │
│  /compare           three engines, side by side            │
└───────────────┬────────────────────────────────────────────┘
                │  POST /api/analyze  { jd, resume, provider }
                ▼
┌────────────────────────────────────────────────────────────┐
│  Next.js API Routes (Vercel serverless, Node runtime)      │
│    /api/analyze      → provider registry → adapter         │
│    /api/extract      → PDF text extraction                 │
│    /api/results/[id] → read a saved analysis               │
│                                                            │
│  lib/providers/                                            │
│    claude.ts      ─────────────► Anthropic Messages API    │
│    openrouter.ts  ─────────────► OpenRouter (free model)   │
│    finetuned.ts   ─────────────► Python scoring service    │
└───────┬──────────────────────────────┬─────────────────────┘
        │                              │
        │ persist / read               │ POST /score
        ▼                              ▼
┌───────────────────┐    ┌──────────────────────────────────┐
│ Supabase Postgres │    │ FastAPI service (HF Space/Render)│
│  analyses table   │    │  fine-tuned MPNet + Platt        │
│  RLS enabled      │    │  src/text_utils, app/explain     │
└───────────────────┘    └──────────────────────────────────┘
```

**Why a separate Python service?** The fine-tuned model is `all-mpnet-base-v2` + PyTorch +
scikit-learn — roughly 420 MB of weights and a heavy dependency tree. Vercel's serverless functions
cap out well below that, and cold-starting Torch per request would be brutal. So the model lives in
one small FastAPI app that owns the `models/` directory and reuses the **exact preprocessing and
skill-gap code already in this repo** (`src/text_utils.py`, `app/explain.py`). Next.js calls it over
HTTP. This is also the honest architecture: an embedding model is a *service*, not a serverless function.

**Data flow — analyze:** client POSTs JD + resume + provider → route validates with Zod → provider
registry resolves an adapter → adapter returns a normalized `AnalysisResult` → (unless privacy mode)
insert into `analyses`, return `{ result, id }` → client renders, and can promote the row to public.

**Data flow — shared result:** `/results/[id]` is a **server component** that reads the row directly
via the Supabase server client (no client-side fetch, no API round trip) and 404s if the row is
missing or `is_public = false`.

## 2.2 Data models

```sql
create table analyses (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  job_description text  not null,
  resume_text     text  not null,
  provider        text  not null check (provider in ('claude','openrouter','finetuned')),
  model_id        text  not null,          -- exact model string, for reproducibility
  result_json     jsonb not null,
  is_public       boolean not null default false,   -- private by default: resumes are PII
  latency_ms      integer,
  user_id         uuid references auth.users(id)    -- null until auth ships (v2)
);

create index analyses_created_at_idx on analyses (created_at desc);
alter table analyses enable row level security;

-- Anonymous users may read a row ONLY if it has been explicitly shared.
create policy "public rows are readable" on analyses
  for select using (is_public = true);
```

> Writes go through the **service-role key from the server only** — never expose that key to the
> client, and never let the browser insert directly.

```ts
// lib/types.ts

export const PROVIDERS = ['claude', 'openrouter', 'finetuned'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** POST /api/analyze request body */
export interface AnalyzeRequest {
  jobDescription: string;   // 50..15000 chars
  resumeText: string;       // 50..15000 chars
  provider: ProviderId;
  ephemeral?: boolean;      // true → do not persist
}

/** Normalized result. Generative fields are optional — the fine-tuned
 *  model is an embedding scorer and cannot produce them. */
export interface AnalysisResult {
  matchScore: number;              // 0..100
  matchedSkills: string[];
  missingSkills: string[];
  strengths: string[];
  suggestedBullets?: string[];     // LLM providers only
  summary?: string;                // LLM providers only
  confidence?: { low: number; high: number };  // fine-tuned only (bootstrap CI)
  meta: {
    provider: ProviderId;
    modelId: string;
    latencyMs: number;
    calibrated: boolean;           // true only for the fine-tuned + Platt path
  };
}

/** What a provider can actually do — the UI reads this, so it never
 *  renders an empty "Suggested bullets" panel for the embedding model. */
export interface ProviderCapabilities {
  score: boolean;
  skillGap: boolean;
  generativeFeedback: boolean;   // bullets + summary
  calibrated: boolean;
}

export interface AnalysisProvider {
  id: ProviderId;
  modelId: string;
  capabilities: ProviderCapabilities;
  analyze(input: { jobDescription: string; resumeText: string }): Promise<AnalysisResult>;
}
```

## 2.3 API design

### `POST /api/analyze`
```jsonc
// Request
{ "jobDescription": "...", "resumeText": "...", "provider": "claude", "ephemeral": false }

// 200
{ "id": "3f2a...", "result": { /* AnalysisResult */ } }

// 400 validation   { "error": "TOO_SHORT", "message": "Job description needs at least 50 words." }
// 429 rate limit   { "error": "RATE_LIMITED", "retryAfter": 30 }
// 502 provider     { "error": "PROVIDER_ERROR", "provider": "openrouter", "message": "..." }
// 503 cold start   { "error": "MODEL_SERVICE_WAKING", "message": "..." }  // HF Space sleeping
```

Error cases to handle explicitly: schema validation failure after one retry (OpenRouter),
`stop_reason: "refusal"` from Claude (surface it — do not silently retry), upstream 429 with
`retry-after`, Python service cold start / unreachable, and request timeout (Vercel function limit).

### `POST /api/compare`
Same body minus `provider`; fans out to all three **in parallel** and returns
`{ results: Partial<Record<ProviderId, AnalysisResult | { error: string }>> }`. One provider
failing must never fail the whole request — that's the entire point of a comparison view.

### `GET /api/results/[id]`
Returns the stored `AnalysisResult` if `is_public = true`, else 404 (**not** 403 — don't confirm
that a private ID exists).

### `POST /api/extract`
`multipart/form-data` with a PDF (≤ 5 MB) → `{ text: string }`.

### Python service: `POST /score`
```jsonc
// Request
{ "resume": "...", "jd": "..." }
// Response
{ "score": 0.72, "raw_cosine": 0.81, "calibrator": "platt",
  "requirements": [ { "requirement": "3+ years Python and SQL",
                      "status": "covered", "similarity": 0.91,
                      "evidence": "Built ETL pipelines in Python..." } ],
  "coverage": 0.57 }
```

## 2.4 Prompt design

Two things from the current Claude API materially change the naive design:

1. **Structured outputs replace "please return strict JSON."** Setting
   `output_config: { format: { type: "json_schema", schema } }` *constrains decoding* — the model
   cannot emit output that violates the schema. The instruction "respond with only valid JSON" is
   therefore unnecessary for Claude, and the elaborate malformed-JSON retry logic in the original
   spec is only needed for the OpenRouter path.
2. **No `temperature` on current Opus models** — the parameter is rejected. Behavior is steered by
   prompting, not sampling knobs.

### System prompt

```
You are an expert technical recruiter and career coach. You evaluate how well a candidate's
resume fits a specific job description, and you give feedback the candidate can act on today.

How to score (0-100). Anchor to these bands and be willing to use the whole range — a
compressed score that calls everything a 70 is useless to the candidate:
  85-100  Strong match. Meets essentially all core requirements with direct, demonstrated evidence.
  70-84   Good match. Meets most core requirements; gaps are secondary or learnable on the job.
  50-69   Partial match. Meets some core requirements; at least one significant gap.
  30-49   Weak match. Adjacent experience but misses the core of the role.
  0-29    Not a match. Different role, different domain, or entry-level against a senior posting.

Weight the JD's stated *requirements* far above its "nice to have" and culture sections. Judge
demonstrated experience, not keyword presence: a resume that lists "Kubernetes" in a skills blob
with no supporting experience is not a Kubernetes match. Conversely, do not penalize a candidate
for lacking a keyword when the experience is clearly evidenced in different words.

Rules you must not break:
- Never invent experience the resume does not contain. Every strength and matched skill must be
  traceable to specific resume text.
- suggestedBullets must be rewrites grounded in experience the resume ALREADY shows — reframed to
  speak to this job. They are not aspirational bullets, and a candidate must be able to say them
  in an interview without lying.
- Be specific and concrete. "Improve your resume" is not feedback. "Your Airflow work is buried
  under 'Other tools' — lead with it, the JD names it twice" is feedback.
- Missing skills are the most useful part of your output. Be honest about them even when the
  overall score is high.
```

### User prompt

```
Score this candidate against this job.

--- JOB DESCRIPTION ---
{jobDescription}

--- RESUME ---
{resumeText}
```

### JSON schema (Claude `output_config.format`, and the Zod mirror for OpenRouter)

```ts
export const analysisSchema = {
  type: 'object',
  properties: {
    matchScore:       { type: 'integer' },
    summary:          { type: 'string' },
    matchedSkills:    { type: 'array', items: { type: 'string' } },
    missingSkills:    { type: 'array', items: { type: 'string' } },
    strengths:        { type: 'array', items: { type: 'string' } },
    suggestedBullets: { type: 'array', items: { type: 'string' } },
  },
  required: ['matchScore', 'summary', 'matchedSkills', 'missingSkills', 'strengths', 'suggestedBullets'],
  additionalProperties: false,
} as const;
```

> Note: structured outputs do not support numeric `minimum`/`maximum`, so `matchScore` is clamped
> to 0–100 in code after parsing rather than in the schema.

### Model selection

| Provider | Model | Why |
|---|---|---|
| Claude | `claude-opus-4-8` (env-overridable) | Current default; supports structured outputs + adaptive thinking. Swap `ANTHROPIC_MODEL=claude-sonnet-5` for ~3× cheaper inference if cost matters — one env var, no code change. |
| OpenRouter | `OPENROUTER_MODEL` env var | Free tier rotates; pick a current `:free` slug from openrouter.ai/models and set it. **Do not hardcode** — free slugs come and go. |
| Fine-tuned | `dlepighe1/resume-jd-matcher-mpnet` + Platt | Your model. The one with external validation. |

Request shape for Claude: `thinking: { type: 'adaptive' }`, `output_config: { effort: 'medium', format: {...} }`,
`max_tokens: 4096`. No `temperature`, no `top_p` — they 400 on Opus 4.8.

---

# Part 3 — Implementation Plan

### Phase 0 — Setup & restructure
The repo becomes a **monorepo-ish two-app layout**: the research code stays, the web app is added.
- Scaffold Next.js 15 + TS + Tailwind into `web/` (`npx create-next-app@latest web --ts --tailwind --app --eslint`).
- Create `service/` for the FastAPI scorer; move nothing yet — it *imports* `src/` and `app/explain.py`.
- `.env.local` (web): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
  `SCORING_SERVICE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Commit a `.env.example`; never the real file.
- Files: `web/`, `service/main.py`, `service/requirements.txt`, `.env.example`, updated `.gitignore`.

### Phase 1 — Basic UI
- `web/app/page.tsx` — two textareas, a provider selector, an Analyze button, an example-data button.
- `web/components/ResultsView.tsx` — pure presentational, driven by `AnalysisResult` + capabilities;
  reused by `/` and `/results/[id]` so a shared link renders identically.
- `web/components/ScoreGauge.tsx`, `SkillList.tsx`. Static mock data for now.

### Phase 2 — Providers + `/api/analyze`
- `web/lib/types.ts`, `web/lib/schema.ts` (Zod + JSON schema).
- `web/lib/providers/claude.ts` — Anthropic SDK, structured outputs, typed error chain
  (`NotFoundError` → `RateLimitError` → `APIStatusError` → `APIConnectionError`), refusal handling.
- `web/lib/providers/openrouter.ts` — fetch-based; JSON extraction + Zod validate + one repair retry.
- `web/lib/providers/finetuned.ts` — HTTP call to the Python service; maps `requirements[]` →
  matched/missing skills; sets `generativeFeedback: false`.
- `web/lib/providers/index.ts` — the registry.
- `web/app/api/analyze/route.ts` — validate → dispatch → normalize → return.
- **Delete `app/llm_critique.py`** here — the Claude path now lives in TypeScript, and that module
  becomes dead code the moment `claude.ts` exists.

### Phase 3 — Python scoring service
- `service/main.py` — FastAPI, loads model + Platt calibrator **once at startup** (not per request),
  `POST /score`, `GET /health`. Reuses `smart_truncate_jd`, `preprocess_resume`, `analyze_skill_gap`.
- `service/test_main.py` — FastAPI `TestClient` + the stub encoder from `tests/conftest.py`, so the
  service is tested **offline**, exactly like the rest of the Python suite.
- Deploy to HF Spaces (Docker SDK) or Render. Set `SCORING_SERVICE_URL` in Vercel.

### Phase 4 — Wire the UI + persistence
- Form → `/api/analyze`, loading + error states, render results.
- Supabase: create the table, RLS policies, server client. Insert on success, redirect to
  `/results/[id]`. Share button flips `is_public`.
- `web/app/results/[id]/page.tsx` — server component, direct DB read, 404 on private/missing.

### Phase 5 — Comparison mode, polish, deploy
- `/api/compare` + `/compare` page: three engines, per-provider error isolation, deltas highlighted,
  external-validation table alongside.
- Rate limiting on `/api/analyze` (Upstash).
- README rewrite: architecture diagram, the research story, screenshots, "why three engines."
- Deploy web → Vercel, service → HF Spaces, DB → Supabase.

---

# Part 4 — How we'll build it

One phase at a time. After each phase: run it, verify it works, then decide whether to continue or
adjust. No 2,000-line code dumps.

---

# Part 5 — How to Present This on a Resume

**Projects section:**

- **ResumeAI — Resume↔JD Matching (Next.js, TypeScript, Python, Claude API).** Fine-tuned a
  sentence-transformer (MPNet + CoSENT/cosine combined loss + Platt calibration) achieving
  **0.86 Spearman / 0.10 MAE on 106 fully held-out pairs from unseen job postings**; exposed it
  through a FastAPI service and a Next.js app that scores a resume against a job description in
  under 3 seconds with a requirement-by-requirement skill-gap explanation.
- **Proved a negative result and acted on it:** built a 212-pair external validation set and showed
  a RoBERTa cross-encoder that scored 0.89 Spearman *internally* collapsed to **−0.61 externally** —
  it had memorized the training JDs. Shipped the smaller calibrated bi-encoder instead, and
  documented why bigger lost.
- **Built a three-engine comparison harness** (fine-tuned model vs. Claude vs. an open-weights
  model) so the specialist model's calibrated scores can be evaluated head-to-head against
  general-purpose LLMs on the same inputs — with structured-output JSON schemas, per-provider error
  isolation, and graceful degradation when a provider is down.

**Portfolio README one-liner:**

> ResumeAI scores how well a resume fits a job description and explains the gap. The interesting
> part isn't the LLM call — it's the fine-tuned model behind it, the external validation set that
> caught it overfitting, and the side-by-side harness that lets you check a specialist model against
> a general one on the same input.

**Metrics you can defend** (all either measured or cheap to measure — never claim one you haven't):
- 0.86 Spearman / 0.10 MAE on 106 held-out pairs from 53 unseen job postings *(measured)*
- 13 of 14 industries under 0.15 MAE *(measured)*
- 106 resumes ranked against one JD in ~1.1 s on a T4 *(measured)*
- End-to-end analysis latency p50 — *measure it and quote the real number*
- Test suite: 56 offline tests, no network, no API keys *(measured — and it's a genuinely
  unusual thing to be able to say about an LLM app)*
