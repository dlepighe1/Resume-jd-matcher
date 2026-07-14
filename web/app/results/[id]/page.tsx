import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ResultsView } from "@/components/ResultsView";
import { getSharedAnalysis, isPersistenceConfigured } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Next 16 removed synchronous access to route params — they are a Promise now. */
type PageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = {
  title: "Shared analysis — ResumeAI",
  // A shared link contains someone's resume. Keep it out of search results even though
  // the holder of the URL can read it.
  robots: { index: false, follow: false },
};

export default async function SharedResultPage({ params }: PageProps) {
  const { id } = await params;

  if (!isPersistenceConfigured() || !UUID.test(id)) notFound();

  const analysis = await getSharedAnalysis(id);
  // A private row and a nonexistent row both 404 — a 403 would confirm that the id
  // exists, which is exactly what someone probing for other people's resumes wants.
  if (!analysis) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
          Shared analysis ·{" "}
          {new Date(analysis.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Resume ↔ Job Match
        </h1>
      </header>

      {/* Read-only: no inputs, no re-run. This is a snapshot of what was scored. */}
      <ResultsView result={analysis.result} />

      <footer className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
        <Link
          href="/"
          className="font-mono text-sm text-[var(--color-brand)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          Analyze your own resume →
        </Link>
      </footer>
    </main>
  );
}
