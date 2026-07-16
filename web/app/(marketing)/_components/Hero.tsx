import Link from "next/link";

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
      <h1 className="font-mono text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-slate-50">
        Smarter matches. Clearer insights. Better opportunities.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
        Score how well your resume fits a job description, see exactly which requirements it
        misses, and track applications in one place — backed by a matching model validated
        against real hiring outcomes.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/sign-up"
          className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-[var(--color-accent)] px-5 font-mono text-sm font-semibold text-white transition-colors duration-200 hover:bg-[var(--color-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Sign up
        </Link>
        <Link
          href="/matcher"
          className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 px-5 font-mono text-sm font-semibold text-slate-800 transition-colors duration-200 hover:border-slate-400 hover:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] dark:border-slate-700 dark:text-slate-200 dark:hover:text-slate-50"
        >
          Try the Matcher
        </Link>
      </div>
    </section>
  );
}
