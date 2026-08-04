# Job-hunt platform: build specification

**Target:** a new, separate repository. This document is the complete brief.

**Relationship to this repository.** `Resume-jd-matcher` is research only. It owns the model,
the evaluation, the data card, and a single demo page. It exposes exactly one thing to the
product: an HTTP scoring service. The product repository consumes that service and owns
everything else. Neither repository imports the other's source.

**Status of the model dependency.** The scoring model is a fine-tuned sentence-transformer
measured at 0.8273 ± 0.0236 Spearman and 0.1194 ± 0.0113 mean absolute error across three
seeds on 106 held-out pairs from unseen job postings, under the Platt calibrator that ships.
Its precision@1 across 53 unseen postings is 84.9%, with a 95% interval of 73% to 92%,
against a 25% random baseline.

Read the `±` as within-run seed spread. Three runs of the identical recipe have produced
aggregate Spearman of 0.8273, 0.8355 and 0.8447, so there is roughly 0.017 of additional
run-to-run variation. Product copy should not quote a precision the evaluation does not
support.

Two constraints on product copy follow from the evaluation, and both are load-bearing:

1. **The score is a ranking signal, not a percentage fit.** The model underscores strong
   matches by roughly 0.17 and overscores weak ones by roughly 0.09, and it never predicts
   above 0.85. Ordering candidates or postings by score is supported. Displaying "you are an
   82% match" is not, and no amount of UI framing repairs it.
2. **The labels are synthetic.** Every metric measures fidelity to a scoring rubric rather
   than to recruiter judgement.

Read `docs/DATA_CARD.md` and the limitations section of `README.md` in this repository before
writing any user-facing copy about what the score means. Treat these figures as a snapshot:
read the live numbers from `Results/results_summary.json` rather than copying them into
product code or marketing, which is exactly how this paragraph went stale once already.

---

## Part 1. Product definition

### 1.1 What it is

A private workspace for one person running a job search. Four surfaces:

| Surface | Purpose | Phase |
|---|---|---|
| **Matcher** | Score a resume against a posting, see requirement coverage and keyword gaps | 1 |
| **Applications** | Track every application through a pipeline, with the match score attached | 1 |
| **Network** | Companies and people related to the applications, and how the user reaches them | 2 |
| **Outreach** | Drafting and sending cold contact, with reply tracking | 3 |

Phases 2 and 3 ship as locked screens in Phase 1. They are advertised, not built. That is a
deliberate choice: both carry legal and data-sourcing questions (contact scraping, sending
reputation, consent) that should not be answered under delivery pressure.

### 1.2 Who it is for

A single job seeker managing 20 to 200 applications. Not recruiters, not employers, not
hiring teams. This matters for the model: it scores a resume against a posting from the
candidate's side, to tell the candidate where their gaps are. Pointing the same score at a
pile of applicants is a different product with a different risk profile, and this
specification does not cover it.

### 1.3 Explicit non-goals

- No employer-side screening, ranking, or filtering of candidates.
- No scraping of personal contact information.
- No automated email sending in Phase 1.
- No billing in Phase 1.
- No team or multi-user workspaces.

---

## Part 2. Architecture

### 2.1 Shape

```
Browser
  |
  v
Next.js app (Vercel)
  |-- Clerk            identity
  |-- Supabase         Postgres, server-side service role only
  |-- Scoring service  the research repo's FastAPI app on a container host
  |-- Anthropic API    optional written feedback
```

One Next.js application, route groups separating public marketing from the authenticated
product. One deploy target. The scoring service is the only external component this
repository does not own.

### 2.2 Why the model is a separate service

The fine-tuned model is roughly 420 MB of PyTorch weights plus a dependency tree that
includes Torch and scikit-learn. That does not fit a serverless function, and cold-starting
Torch per request would be unusable. It runs as a long-lived container. An embedding model is
a service, not a lambda.

### 2.3 Integration contract with the research repository

This is the only coupling between the two repositories. Treat it as a published API.

**`POST /score`**

```jsonc
// Request
{ "resume": "string, >= 50 words", "jd": "string, >= 50 words" }

// 200
{
  "score": 0.72,               // calibrated 0 to 1
  "raw_cosine": 0.81,          // uncalibrated, for diagnostics
  "calibrator": "platt",       // null when no calibrator is loaded
  "model_id": "dlepighe1/resume-jd-matcher-mpnet",
  "requirements": [
    { "requirement": "3+ years Python and SQL",
      "status": "covered",     // covered | partial | missing
      "similarity": 0.91,
      "evidence": "Built ETL pipelines in Python" }
  ],
  "coverage": 0.57
}

// 422  input below the minimum word count
```

**`POST /baseline`** returns `{ raw_cosine, model_id, calibrated: false }` from the
un-fine-tuned base model. Used for the comparison view. It deliberately returns no `score`
field, because the calibrator maps the fine-tuned model's distribution and applying it here
would produce a confident number that means nothing.

**`GET /health`** returns `{ status, model_id, calibrator, fine_tuned }`. The `fine_tuned`
flag is false when the service fell back to the base model. **The product must surface that
state rather than silently serving uncalibrated scores as if they were calibrated.**

**Rules the product must respect:**

1. Do not reimplement the preprocessing. The service applies the exact 350-word truncation
   the model was trained under. Sending pre-truncated text will silently degrade scores.
2. Do not cache scores across model versions. Key any cache on `model_id`.
3. Treat a `fine_tuned: false` health response as a degraded state and label the UI
   accordingly.
4. Expect cold starts. On a scale-to-zero host the first request can take 30 to 60 seconds.
   Show a waking state, not a spinner that looks hung.

### 2.4 Engine policy

The matcher offers more than one engine, but **runs one engine per request, on demand**.
Never fan out automatically. The default is the fine-tuned model, which costs nothing per
call. Language-model engines are opt-in per analysis, because a default that quietly spends
API credits on every keystroke is how a side project generates a surprise invoice.

| Engine | Cost | Produces |
|---|---|---|
| Fine-tuned MPNet + Platt (default) | Free | Calibrated score, requirement coverage |
| Base MPNet | Free | Raw similarity, for the before-and-after comparison |
| Keyword coverage | Free, no model | Literal ATS-style matching and ranked gaps |
| Claude | Per call | Written feedback, suggested bullet rewrites |

---

## Part 3. Data model

Postgres via Supabase. Row-level security is enabled on every table. All writes go through
the Next.js server using the service-role key, scoped to the Clerk user id. The service-role
key never reaches the browser.

```sql
-- Clerk owns identity. This table exists so foreign keys have a local target and so
-- per-user settings have somewhere to live.
create table profiles (
  id           text primary key,              -- Clerk user id
  email        text not null,
  created_at   timestamptz not null default now(),
  settings     jsonb not null default '{}'::jsonb
);

create table resumes (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references profiles(id) on delete cascade,
  label        text not null,                  -- "Data engineer, 2026"
  content      text not null,                  -- extracted plain text
  file_path    text,                           -- Supabase Storage object, nullable
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index resumes_user_idx on resumes (user_id, created_at desc);

create table applications (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references profiles(id) on delete cascade,
  company        text not null,
  role_title     text not null,
  location       text,
  posting_url    text,
  posting_text   text,                         -- kept so a score can be recomputed
  resume_id      uuid references resumes(id) on delete set null,
  status         text not null default 'saved'
                 check (status in ('saved','applied','screening','interview','offer','rejected','withdrawn')),
  applied_at     date,
  salary_min     integer,
  salary_max     integer,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index applications_user_idx on applications (user_id, updated_at desc);
create index applications_status_idx on applications (user_id, status);

-- One row per scoring run. Applications keep their history rather than overwriting,
-- so "did tailoring my resume help?" is answerable.
create table analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references profiles(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  resume_id      uuid references resumes(id) on delete set null,
  engine         text not null check (engine in ('finetuned','base','claude','keyword')),
  model_id       text not null,                -- exact model string, for reproducibility
  score          numeric(5,4),                 -- 0 to 1, null for engines that do not score
  calibrated     boolean not null default false,
  result_json    jsonb not null,               -- requirement coverage, keyword gaps, prose
  latency_ms     integer,
  created_at     timestamptz not null default now()
);
create index analyses_application_idx on analyses (application_id, created_at desc);

-- Append-only. Feeds the pipeline timeline and, later, automatic status detection.
create table application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  kind           text not null,                -- status_changed | analysis_run | note_added
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index application_events_idx on application_events (application_id, created_at desc);

alter table profiles            enable row level security;
alter table resumes             enable row level security;
alter table applications        enable row level security;
alter table analyses            enable row level security;
alter table application_events  enable row level security;

-- No permissive policies. Every read and write goes through the server with the
-- service-role key, which bypasses RLS by design. RLS is on so that a leaked anon key
-- grants nothing, rather than as the primary authorization mechanism.
```

**Authorization model.** Clerk owns identity. The Next.js server owns authorization: every
query filters on the Clerk user id resolved server-side. RLS is defence in depth, not the
control. This is a deliberate choice over wiring Clerk JWTs into Postgres policies; it keeps
authorization in one readable place at the cost of relying on server discipline. Enforce that
discipline with a single data-access module that takes `userId` as its first argument, and a
lint rule or test that fails if any route queries Supabase directly.

**Retention.** Resumes are personal data. Deleting an account must cascade to every table,
which the foreign keys above already do, and must also delete Storage objects, which they do
not. Handle Storage explicitly.

---

## Part 4. API design

All routes are Next.js route handlers under `app/api`. All require an authenticated Clerk
session except where noted.

| Route | Method | Purpose |
|---|---|---|
| `/api/score` | POST | Score one pair with one engine. Guest-accessible, nothing persisted |
| `/api/applications` | GET, POST | List and create |
| `/api/applications/[id]` | GET, PATCH, DELETE | Read, update, remove |
| `/api/applications/[id]/analyses` | GET, POST | Score history, run a new analysis |
| `/api/resumes` | GET, POST | List and create |
| `/api/resumes/[id]` | GET, PATCH, DELETE | Read, update, remove |
| `/api/extract` | POST | PDF to text, `multipart/form-data`, max 5 MB |

**`POST /api/score`**

```jsonc
// Request
{ "jobDescription": "...", "resumeText": "...", "engine": "finetuned",
  "applicationId": "uuid|null" }   // null means do not persist

// 200
{ "engine": "finetuned", "modelId": "...", "score": 0.72, "calibrated": true,
  "requirements": [...], "keywords": { "score": 61, "matched": [...], "gaps": [...] },
  "summary": null, "latencyMs": 812, "analysisId": "uuid|null" }

// 400 TOO_SHORT | INVALID_REQUEST
// 429 RATE_LIMITED         { "retryAfter": 30 }
// 502 PROVIDER_ERROR       { "engine": "claude", "message": "..." }
// 503 MODEL_SERVICE_WAKING { "message": "..." }
```

**Error handling requirements.** Each failure mode gets a distinct code and a message a user
can act on. A rate limit says when to retry. An auth failure blames the configuration, not
the user. A cold start says the service is waking. A model refusal is surfaced, never retried
silently. Do not collapse these into "something went wrong".

**Rate limiting.** Per-user token bucket on `/api/score`, backed by Upstash Redis or
equivalent. Stricter limit on the Claude engine than on the free engines. This is not
optional before the URL is public.

---

## Part 5. Feature specifications

### 5.1 Matcher (Phase 1)

Paste or select a resume, paste a posting or supply a URL, pick an engine, analyze.

Output:

1. **Score**, 0 to 100, with its verdict band, and an explicit statement of whether it is
   calibrated. Show the model's measured error as a band, not as a fabricated per-prediction
   confidence interval. There is no principled way to compute the latter for a single pair,
   and inventing one would be worse than omitting it.
2. **Requirement coverage**: each requirement in the posting marked covered, partial, or
   missing, with the resume sentence that matched it.
3. **Keyword gaps**, ranked. Priority comes from the posting alone: how many times a term is
   named, and whether it sits in the requirements section rather than the company blurb. It is
   **not** a prediction of score movement. Do not present it as one.
4. **The keyword-stuffing warning.** Adding a term the resume cannot evidence reproduces the
   pattern the model was trained to catch. Hard negatives in the training data are exactly
   keyword-dense wrong-role resumes. Say so at the point of the suggestion.
5. **Written feedback**, only when a language-model engine was selected, and labelled as
   coming from that model.

A guest can use the matcher without an account. Nothing is saved. Prompt to sign up to keep
the result.

### 5.2 Applications (Phase 1)

Table first. Columns: company, role, status, match score, applied date, last activity.
Sortable, filterable by status, searchable by company and role. Inline status change writes
an `application_events` row.

Creating an application from a matcher result carries the posting text and the analysis
across, so the score is attached rather than recomputed.

Detail view: posting, resume used, full analysis history as a timeline, notes, events.

**Score history is the interesting part.** Because analyses are append-only, the detail view
can plot score against time as the user tailors a resume. That answers a question most tools
avoid: did the suggestions actually help? If the answer is no, that is a finding worth
surfacing rather than hiding.

### 5.3 Network (Phase 2, locked in Phase 1)

Companies and people connected to the user's applications. Deferred pending answers to: where
does company data come from, what personal data may be stored and under what basis, and how
to avoid building a scraper. Ship a locked screen that describes the intent and captures
interest.

### 5.4 Outreach (Phase 3, locked in Phase 1)

Drafting and sending contact, with reply tracking. Deferred pending answers to: which email
service, how sending reputation is protected, and how consent and unsubscribe are handled.
Ship a locked screen.

---

## Part 6. Build plan

Each phase ends with a deployable application. No phase leaves the product broken.

**Phase 0. Foundation.** Next.js with TypeScript and Tailwind, Clerk with Google and email
sign-in, Supabase project and schema, the data-access module, and a deployed skeleton with a
health check that reports the scoring service's state.

**Phase 1a. Matcher.** Port the scoring route, the engine adapters, and the result components
from the research repository's demo. The adapters and the keyword module transfer with only
minor changes. Guest access, no persistence.

**Phase 1b. Persistence.** Resumes, applications, analyses, and events. Save from the matcher,
list, edit, delete. Account deletion cascading to Storage.

**Phase 1c. Pipeline.** The applications table, status transitions, the detail timeline, and
the score-history chart.

**Phase 1d. Hardening.** Rate limiting, error states, empty states, mobile layout, PDF
extraction, and the locked Network and Outreach screens.

**Phase 2 and Phase 3** each get their own specification before any code.

---

## Part 7. Non-functional requirements

**Privacy.** A resume is personal data. Store nothing from a guest session. Provide export
and delete. Never place resume text in a URL, a log line, or an analytics event. If shareable
result links are added later, default them to private and require an explicit action to
publish, with unguessable identifiers.

**Testing.** Every test offline: no model downloads, no API calls, no live database. Replace
the sentence-transformer with a stub encoder using fixed vectors, and the language-model
provider with a stubbed transport. That is what makes assertions about similarity bands and
calibration exact. The research repository does this and it should be copied, not reinvented.

Test the invariants that fail silently:

- the calibrator is never applied to base-model output
- a degraded scoring service is reported, never rendered as a normal score
- one engine failing never blanks the others in a comparison view
- every data-access call is scoped to the current user

**Observability.** Log engine, model id, latency, and outcome per analysis. Never log input
text.

**Cost control.** Rate limits per user. Language-model engines opt-in per analysis. An
alert on daily spend before the URL is public.

**Accessibility.** Keyboard navigable, labelled form controls, visible focus, colour never
the sole carrier of meaning, and a text alternative for every chart.

---

## Part 8. Decisions the owner still needs to make

These are genuine forks, not details. Each changes the build.

1. **Scoring service host.** Scale-to-zero (cheap, 30 to 60 second cold starts, needs a
   waking state in the UI) or always-on (roughly 7 to 25 USD per month, no cold start).
2. **Whether guests can use the matcher.** Better funnel, but it is an unauthenticated
   endpoint that costs compute. Requires stricter rate limiting by IP.
3. **Posting URL fetching.** Convenient, but the major job boards block it. Design for
   failure and fall back to paste, or omit it entirely in Phase 1.
4. **Whether written feedback ships in Phase 1.** It is the most visibly impressive feature
   and the only one with a per-use cost.
5. **Model versioning.** When the research repository publishes a new checkpoint, do stored
   analyses keep their original scores (recommended, since `model_id` is already stored) or
   get recomputed?

---

## Appendix A. What transfers from the research repository

Copy these rather than rewriting them. Each has tests.

| From | What it is |
|---|---|
| `web/lib/ats.ts` | Keyword coverage and gap ranking, with alias handling and boundary rules |
| `web/lib/providers/finetuned.ts` | Scoring service adapter, including the error taxonomy |
| `web/lib/providers/baseline.ts` | Base-model adapter |
| `web/lib/providers/claude.ts` | Claude adapter with schema-constrained output |
| `web/lib/errors.ts` | Error codes and their HTTP mapping |
| `web/lib/schema.ts` | The scoring prompt and its JSON schema |
| `web/lib/benchmark.ts` | Verdict bands, so the product and the research agree on what a score means |

## Appendix B. Copy constraints

The product describes a model whose labels are synthetic. These constraints are not
stylistic.

- Never describe the score as a probability of being hired, interviewed, or shortlisted.
  Nothing in the evaluation supports that.
- Never present the model as a screening or ranking tool for employers.
- State when a score is uncalibrated. The base model and the language models are not
  calibrated, and their numbers are not comparable to the fine-tuned model's on absolute
  value, only on ordering.
- When quoting accuracy, quote the interval alongside it. The test set is 106 pairs and the
  intervals are wide.
- Do not claim the model reads between the lines, understands career narratives, or accounts
  for context. It computes similarity between two documents.
