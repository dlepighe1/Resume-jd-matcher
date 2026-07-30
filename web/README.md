# Demo page

A single Next.js page for inspecting the resume/job-description matcher: live scoring, the
held-out benchmark, and the evidence behind both.

This directory contains no product features. Authentication, persistence, and the multi-page
application were removed when this repository became research-only. The SaaS built on top of
this model lives in its own repository; see `docs/SAAS_SPEC.md` at the repository root.

## Running it

```bash
npm install
cp .env.example .env.local   # both variables are optional
npm run dev                  # http://localhost:3000
```

The page reads `public/benchmark.json`. Regenerate it from the repository root:

```bash
python scripts/build_demo_data.py
```

That script assembles the bundle from the external test CSV, the Claude benchmark, and
`Results/demo_pairs.json` (produced by `Notebooks/06_model_audit.ipynb`). It refuses to
include fine-tuned predictions whose raw Spearman disagrees with
`Results/production_results.json`, so a mismatched model cannot reach the page.

## Structure

```
app/page.tsx              The whole page. Reads benchmark.json server-side
app/api/score/route.ts    Live scoring. Fans out to every configured engine
components/demo/          Page sections
components/charts/        SVG charts, no charting library
lib/benchmark.ts          Bundle types, Spearman, verdict bands
lib/ats.ts                Deterministic keyword coverage
lib/providers/            Fine-tuned, base-model, and Claude adapters
```

Every metric shown on the page comes from `benchmark.json`. No figure is written into a
component, so a number on the page cannot drift from the evaluation that produced it.

## Tests

```bash
npm test
```

All offline. No network, no API keys, no model downloads.
