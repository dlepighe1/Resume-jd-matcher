# Job-Hunt Platform — Foundation (Phase 1) Design

**Date:** 2026-07-15
**Status:** Approved for implementation planning
**Supersedes nothing** — extends the existing `web/` Next.js app and `analyses` schema.

## 1. Summary

Evolve ResumeAI from a single-purpose resume/JD matcher into the foundation of a
job-hunt platform: a public marketing page, authenticated dashboard, the existing
matcher moved in, and a job-application pipeline tracker. Two larger subsystems —
**Network** (company/people graph) and **Outreach** (cold email) — are advertised
but ship as locked "coming soon" screens; they are intentionally out of scope for
this phase pending more research (legal/compliance, data sources, ESP integration).

This is **Phase 1** of a decomposed roadmap. Later phases (each its own
spec → plan → build) add Network, then Outreach.

## 2. Goals

- Turn the demo into a real product: landing page → sign-up → dashboard.
- Authentication via **Clerk** (Google, Facebook, email/password) with a
  try-before-signup guest path.
- Move the existing matcher into the authed dashboard, with an **engine picker**
  that runs **only the selected engine on demand** (no auto-parallel), preserving
  per-engine comparison detail (scores + validation metrics).
- A **table-first Applications pipeline** with manual and in-app-automatic status.
- Advertise Network and Outreach without building them.

## 3. Non-Goals (this phase)

- No scraping of people/contact info; no company enrichment.
- No email sending / ESP integration / Gmail connection.
- No email-based automatic status detection (seam left for it; not built).
- No billing/subscriptions.

## 4. Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Auth provider | **Clerk** | Native Google/Facebook/email; hosted UI. |
| Guest handling | **Try-before-signup** (matcher usable un-authed, nothing saved) | Clerk has no first-class anonymous auth; standard SaaS funnel. |
| Clerk ↔ Supabase | Clerk owns identity; **Next.js server owns authz** via service-role Supabase scoped to Clerk `userId` | Matches existing `analyses` pattern; avoids wiring Clerk JWT into RLS. |
| Engine runs | **On-demand, single engine per Analyze** | Cost control; no token burn from auto-parallel. |
| Default engine | **Local fine-tuned MPNet (free)** | Safe default — a casual analyze never spends API credits. |
| Menu naming | **Matcher · Applications · Network · Outreach** | Approved scheme B. |
| Applications view | **Table-first**, Kanban optional later | User preference; inline status dropdown. |
| Status automation | **Phased**: in-app events now, email detection later | Email detection depends on the parked Outreach/Gmail layer. |
| App structure | **One Next.js app, route groups** `(marketing)` / `(app)` | One deploy; reuses existing app. |

## 5. Architecture

### 5.1 Routing

```
web/app/
  (marketing)/
    page.tsx              # public landing page
  (app)/
    layout.tsx            # dashboard shell (navbar + theme), Clerk-guarded
    matcher/page.tsx      # existing analyze flow (default tab; reachable un-authed, read-only)
    applications/page.tsx # table-first pipeline
    network/page.tsx      # "coming soon" locked screen
    outreach/page.tsx     # "coming soon" locked screen
  api/
    analyze/  compare/  extract/  share/   # existing (compare route changes: no auto-run-all)
    applications/         # CRUD for applications
    resumes/              # CRUD + signed-URL issuance for resume files
middleware.ts             # Clerk: (marketing) public; (app) requires auth EXCEPT matcher (read-only guest)
```

### 5.2 Auth & Authorization

- Clerk `<SignIn>` / `<SignUp>` components; providers: Google, Facebook, email/password.
- **Guest / try-before-signup:** the Matcher route renders and analyzes without a
  session. Guarded actions — save to Applications, selecting a paid engine, opening
  Applications/Network/Outreach — trigger Clerk sign-in.
- **Authorization:** every API route resolves `userId` via Clerk `auth()`. All
  Supabase access is server-side with the **service-role key**, filtered by `userId`.
  Un-authed matcher analyze returns a result but **does not persist**.

### 5.3 Theme

- Navbar light/dark toggle; preference persisted per user (Clerk user metadata or a
  `user_prefs` row). Un-authed falls back to system preference + localStorage.

## 6. Data Model

New tables use `user_id text` (Clerk ID). Existing `analyses` table extended.

```sql
-- EXISTING, extended:
alter table analyses add column if not exists user_id text;   -- null for un-authed "try" runs (not persisted)

-- Per-user resume library (upload/paste once, reuse everywhere):
create table resumes (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  label          text,
  file_path      text,            -- private Storage bucket 'resumes'; null if pasted text only
  extracted_text text,
  created_at     timestamptz not null default now()
);

-- Application pipeline:
create table applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  company      text,
  job_title    text,
  job_url      text,
  location     text,
  status       text not null default 'saved'
                 check (status in ('saved','applied','interviewing','offer','rejected')),
  applied_at   timestamptz,                       -- stamped when status -> 'applied'
  resume_id    uuid references resumes(id),       -- optional: resume used
  analysis_id  uuid references analyses(id),      -- optional: the match run for this job
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

- **Storage:** private Supabase bucket `resumes`; files reached only via short-lived
  signed URLs issued by the server. RLS unchanged (service-role on server; public
  read only for shared analyses).
- **Resumes are a library**, not per-application copies — avoids duplicate PDFs.
- **`analysis_id`** links a saved job back to the match that produced it (score,
  engine, gaps travel with "Save to Applications").

## 7. Feature Behavior

### 7.1 Matcher

- Inputs: job description + resume (from library, fresh upload, or pasted text).
- Engine picker (top-right of workspace toolbar), default **fine-tuned MPNet**.
- **Analyze runs only the selected engine** — one call, one cost.
- Results: score gauge, strengths/gaps, per-engine detailed feedback.
- **Engine Comparison** panel: a row per engine. Un-run engines show **▶ Run**;
  paid engines (Claude, OpenRouter) show a credit note, the free local one does not.
  Running fills that engine's row. Results cached so re-viewing costs nothing.
- Primary results action: **Save to Applications** → creates an `application`
  (`status='saved'`) with `analysis_id` and optional `resume_id`.
- **`/api/compare` change:** must no longer run all engines automatically; it
  returns/aggregates only engines that have been run.

### 7.2 Applications

- **Table-first** view; columns include company, job title, match score (if any),
  resume-used chip, status, date. Optional list↔board toggle can come later.
- **Status column = inline-editable dropdown** (manual override always available).
- **Automatic transitions (Phase 1, in-app events only):** saving a match sets
  `saved`; setting status to `applied` stamps `applied_at`. The field is designed so
  **email-driven detection** can advance status later without schema change.
- Row → detail drawer: notes, links, change resume, re-run match.
- Empty state links back to the Matcher.

### 7.3 Network & Outreach (coming soon)

- Locked screens: icon, one-paragraph description, optional **"Notify me"** capture.
- No fake controls, no dead ends.

### 7.4 Landing page

- Hero (positioning + two CTAs: **Sign up**, **Try the Matcher**).
- Features advertised: 3 engines/one verdict (with 0.86 Spearman / 0.10 MAE hook),
  match score + strengths/gaps, Applications pipeline tracker.
- Coming-soon teasers for Network and Outreach with "Notify me".
- Footer seed for compliance messaging (fleshed out when Outreach is built).

## 8. Testing

- **API routes:** unit tests (Vitest) for `applications` and `resumes` CRUD,
  including authz (a user cannot read/write another user's rows) and guest paths
  (un-authed analyze does not persist).
- **Matcher:** test that Analyze calls exactly one engine; `/api/compare` returns
  only run engines and never auto-runs all.
- **Status logic:** setting `applied` stamps `applied_at`; manual override respected.
- **Storage:** signed URLs are short-lived and server-issued; no public bucket read.
- Follow the existing `web/` testing conventions and the "this is NOT the Next.js you
  know" note in `web/AGENTS.md` (read `node_modules/next/dist/docs/` before coding).

## 9. Risks & Open Questions

- **Clerk + service-role authz** puts full trust in the server layer — every route
  must resolve `userId` and filter by it; a missed filter is a data-leak. Centralize
  the "get userId or 401" + query-scoping helper and test it.
- **Guest matcher** must be genuinely non-persisting and rate-limited (reuse existing
  `rate-limit.ts`) to avoid abuse.
- **Coming-soon capture** stores emails — keep it minimal and disclosed.
- Facebook OAuth app review can take time; Google + email can ship first if needed.

## 10. Out-of-scope future phases

- **Phase 2 — Network:** compliant company/people data (APIs / opt-in enrichment, not
  scraping), hierarchy graph, contact records. Own spec.
- **Phase 3 — Outreach:** ESP integration (Resend/SendGrid/Postmark) with SPF/DKIM/
  DMARC, CAN-SPAM/GDPR compliance, templates, and email-driven status detection. Own spec.
