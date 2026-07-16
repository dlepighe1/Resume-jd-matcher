import Link from "next/link";

// Placeholder for the Phase-1 Applications pipeline (built out in a later plan).
// Kept as a real, reachable page so the navbar link never 404s; frames the empty
// state and points back to the Matcher, which is where applications get created.
export default function ApplicationsPage() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mb-4 text-4xl">🗂️</div>
      <h1 className="mb-2 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100">
        Your applications will live here
      </h1>
      <p className="mb-6 text-slate-600 dark:text-slate-400">
        The pipeline tracker is being built. Soon you&apos;ll save jobs you&apos;ve applied to —
        with the resume you used and the match score — and move them through stages.
      </p>
      <Link
        href="/matcher"
        className="inline-flex min-h-11 items-center rounded-lg bg-[var(--color-accent)] px-5 font-mono text-sm font-semibold text-white transition-colors duration-200 hover:bg-[var(--color-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        Analyze a job →
      </Link>
    </div>
  );
}
