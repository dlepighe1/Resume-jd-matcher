"use client";

import { useId, useState } from "react";

import { CheckCircleIcon, SpinnerIcon } from "@/components/icons";

type Feature = "network" | "outreach";

const TEASERS: { feature: Feature; title: string; description: string }[] = [
  {
    feature: "network",
    title: "Network",
    description:
      "Map the people and hierarchy behind a company, with contacts you can reach — built on compliant data sources, not scraping.",
  },
  {
    feature: "outreach",
    title: "Outreach",
    description:
      "Compose and send cold-outreach emails to your contacts, with tracking that advances your applications automatically.",
  },
];

export function ComingSoonTeaser() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      <h2 className="text-center font-mono text-xl font-semibold text-slate-900 sm:text-2xl dark:text-slate-100">
        Coming soon
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-600 dark:text-slate-400">
        Two more pieces of the job hunt are in the works. Leave your email and we&apos;ll let you
        know the moment they&apos;re ready.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {TEASERS.map((teaser) => (
          <TeaserCard key={teaser.feature} {...teaser} />
        ))}
      </div>
    </section>
  );
}

function TeaserCard({
  feature,
  title,
  description,
}: {
  feature: Feature;
  title: string;
  description: string;
}) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, feature }),
      });
      // Guard against a non-JSON body (e.g. a 5xx with an HTML/empty payload) so it
      // reports the real HTTP failure instead of falling into the catch and mislabeling
      // it as a network error.
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(data.message ?? "Could not save your signup.");
        setStatus("error");
        return;
      }

      setStatus("success");
    } catch {
      setErrorMessage("Could not reach the server.");
      setStatus("error");
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {description}
      </p>

      {status === "success" ? (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"
        >
          <CheckCircleIcon className="h-5 w-5" />
          You&apos;re on the list — we&apos;ll email you when {title.toLowerCase()} launches.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-start gap-2">
          <label htmlFor={inputId} className="sr-only">
            Email address for {title} updates
          </label>
          <input
            id={inputId}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={status === "submitting"}
            placeholder="you@example.com"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus-visible:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand)] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 font-mono text-sm font-semibold text-white transition-colors duration-200 hover:bg-[var(--color-brand-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "submitting" && <SpinnerIcon className="h-4 w-4 animate-spin" />}
            {status === "submitting" ? "Sending…" : "Notify me"}
          </button>

          {status === "error" && errorMessage && (
            <p role="alert" className="w-full text-xs text-rose-700 dark:text-rose-400">
              {errorMessage}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
