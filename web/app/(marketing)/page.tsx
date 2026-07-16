import Link from "next/link";

import { ComingSoonTeaser } from "./_components/ComingSoonTeaser";
import { FeatureGrid } from "./_components/FeatureGrid";
import { Hero } from "./_components/Hero";

export default function MarketingHome() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-brand)] text-xs font-extrabold text-slate-950">
            AI
          </span>
          <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
            ResumeAI
          </span>
        </Link>
        <Link
          href="/sign-in"
          className="font-mono text-sm text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] dark:text-slate-400 dark:hover:text-slate-100"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1">
        <Hero />
        <FeatureGrid />
        <ComingSoonTeaser />
      </main>

      <footer className="border-t border-slate-200 px-5 py-6 dark:border-slate-800">
        <p className="mx-auto max-w-6xl text-center text-xs text-slate-500 dark:text-slate-500">
          &copy; {new Date().getFullYear()} ResumeAI. When Outreach ships, every email it sends
          will follow CAN-SPAM and GDPR requirements — including a working unsubscribe and a
          lawful basis for contact.
        </p>
      </footer>
    </div>
  );
}
