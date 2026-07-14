-- Run this in the Supabase SQL editor (or `supabase db push`).
--
-- Privacy posture: a resume is PII. Rows are created PRIVATE and only become readable
-- when the user explicitly clicks Share. IDs are UUIDs, never sequential, so a stored
-- analysis cannot be found by walking /results/1, /results/2, ...

create table if not exists analyses (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  job_description text    not null,
  resume_text     text    not null,

  provider        text    not null check (provider in ('claude', 'openrouter', 'finetuned')),
  model_id        text    not null,   -- the exact model string, so a result stays reproducible
  result_json     jsonb   not null,
  latency_ms      integer,

  is_public       boolean not null default false,

  user_id         uuid references auth.users (id)   -- null until auth lands in v2
);

create index if not exists analyses_created_at_idx on analyses (created_at desc);

alter table analyses enable row level security;

-- The anon key can read a row only after it has been shared. Everything else — inserts,
-- reads of private rows, flipping is_public — goes through the server with the
-- service-role key, which bypasses RLS and is never sent to the browser.
drop policy if exists "shared analyses are publicly readable" on analyses;
create policy "shared analyses are publicly readable"
  on analyses for select
  using (is_public = true);
