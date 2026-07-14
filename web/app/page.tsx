"use client";

import Link from "next/link";
import { useState } from "react";

import { ErrorPanel, type AnalyzeFailure } from "@/components/ErrorPanel";
import { ProviderSelect } from "@/components/ProviderSelect";
import { ResultsView } from "@/components/ResultsView";
import { SpinnerIcon, TrendingUpIcon } from "@/components/icons";
import { EXAMPLE_JD, EXAMPLE_RESUME } from "@/lib/examples";
import { MIN_WORDS, wordCount, type AnalysisResult, type ProviderId } from "@/lib/types";

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [provider, setProvider] = useState<ProviderId>("finetuned");

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [failure, setFailure] = useState<AnalyzeFailure | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  const jdWords = wordCount(jobDescription);
  const resumeWords = wordCount(resumeText);
  const canAnalyze = jdWords >= MIN_WORDS && resumeWords >= MIN_WORDS && !isAnalyzing;

  async function handleAnalyze() {
    setIsAnalyzing(true);
    setResult(null);
    setFailure(null);
    setAnalysisId(null);
    setShareUrl(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription, resumeText, provider }),
      });
      const data = await response.json();

      if (!response.ok) {
        setFailure({ code: data.error, message: data.message, retryAfter: data.retryAfter });
        return;
      }

      setResult(data.result);
      setAnalysisId(data.id); // null when Supabase isn't configured — sharing stays hidden
    } catch {
      setFailure({
        code: "NETWORK",
        message: "Could not reach the analyzer.",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleShare() {
    if (!analysisId) return;
    setIsSharing(true);
    try {
      const response = await fetch(`/api/share/${analysisId}`, { method: "POST" });
      if (!response.ok) return;
      const data = await response.json();
      setShareUrl(`${window.location.origin}${data.url}`);
    } finally {
      setIsSharing(false);
    }
  }

  async function handleUpload(file: File) {
    setIsExtracting(true);
    setExtractError(null);
    setExtractNote(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/extract", { method: "POST", body: form });
      const data = await response.json();

      if (!response.ok) {
        setExtractError(data.message);
        return;
      }

      setResumeText(data.text);
      // Never silent. A two-column resume can extract as interleaved nonsense, and the
      // user is the only one who can tell — so the text goes in the box for them to check.
      setExtractNote(`Extracted ${data.words} words — check it reads correctly before analyzing.`);
    } catch {
      setExtractError("Could not read that file.");
    } finally {
      setIsExtracting(false);
    }
  }

  function loadExample() {
    setJobDescription(EXAMPLE_JD);
    setResumeText(EXAMPLE_RESUME);
    setResult(null);
    setFailure(null);
    setExtractNote(null);
    setExtractError(null);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Resume ↔ Job Match Analyzer
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-slate-600 dark:text-slate-400">
          Score how well a resume fits a job description and see exactly which requirements it
          misses. Runs on a fine-tuned matching model validated against{" "}
          <span className="font-mono text-slate-800 dark:text-slate-200">
            106 held-out pairs from unseen postings
          </span>{" "}
          — or compare it against a general-purpose LLM on the same pair.
        </p>
        <Link
          href="/compare"
          className="mt-3 inline-block font-mono text-sm text-[var(--color-brand)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          Run all three engines side by side →
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <TextAreaField
            id="job-description"
            label="Job description"
            hint="Paste the full posting. Boilerplate is stripped automatically."
            value={jobDescription}
            onChange={setJobDescription}
            words={jdWords}
            disabled={isAnalyzing}
          />

          <div>
            <TextAreaField
              id="resume"
              label="Resume"
              hint="Paste the resume text, or upload a PDF. It is never shared unless you choose to share it."
              value={resumeText}
              onChange={setResumeText}
              words={resumeWords}
              disabled={isAnalyzing}
            />

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label
                className={`inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 font-mono text-xs transition-colors duration-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-brand)] dark:border-slate-700 ${
                  isExtracting || isAnalyzing
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer text-slate-700 hover:border-slate-400 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                }`}
              >
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={isExtracting || isAnalyzing}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleUpload(file);
                    event.target.value = ""; // let the same file be re-selected
                  }}
                  className="sr-only"
                />
                {isExtracting ? "Reading PDF…" : "Upload PDF"}
              </label>

              {/* Extraction is never silent: a two-column layout can produce interleaved
                  nonsense, so the text lands in the box above for the user to check. */}
              {extractNote && (
                <p className="text-xs text-slate-600 dark:text-slate-400">{extractNote}</p>
              )}
              {extractError && (
                <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
                  {extractError}
                </p>
              )}
            </div>
          </div>

          <ProviderSelect value={provider} onChange={setProvider} disabled={isAnalyzing} />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 font-mono text-sm font-semibold text-white transition-colors duration-200 hover:bg-[var(--color-accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <TrendingUpIcon className="h-4 w-4" />
                  Analyze match
                </>
              )}
            </button>

            <button
              type="button"
              onClick={loadExample}
              disabled={isAnalyzing}
              className="min-h-11 cursor-pointer rounded-lg px-3 font-mono text-sm text-slate-600 underline-offset-4 transition-colors duration-200 hover:text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Load example
            </button>
          </div>

          {!canAnalyze && !isAnalyzing && (jdWords > 0 || resumeWords > 0) && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Both texts need at least {MIN_WORDS} words. Below that there isn&apos;t enough
              signal to score honestly.
            </p>
          )}
        </div>

        <div aria-live="polite" aria-busy={isAnalyzing}>
          {isAnalyzing && <ResultsSkeleton />}

          {!isAnalyzing && failure && <ErrorPanel failure={failure} />}

          {!isAnalyzing && result && (
            <div className="space-y-4">
              <ResultsView result={result} />

              {analysisId && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  {shareUrl ? (
                    <div className="space-y-2">
                      <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
                        Anyone with this link can read this analysis.
                      </p>
                      <input
                        readOnly
                        value={shareUrl}
                        onFocus={(event) => event.currentTarget.select()}
                        aria-label="Shareable link"
                        className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        This analysis is private. Sharing creates a public read-only link.
                      </p>
                      <button
                        type="button"
                        onClick={handleShare}
                        disabled={isSharing}
                        className="min-h-11 cursor-pointer rounded-lg border border-slate-300 px-4 font-mono text-sm text-slate-700 transition-colors duration-200 hover:border-slate-400 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                      >
                        {isSharing ? "Creating link…" : "Share"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isAnalyzing && !result && !failure && (
            <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <p className="font-mono text-sm text-slate-600 dark:text-slate-400">
                Your analysis will appear here
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-500">
                Paste a job description and a resume, or load the example.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function TextAreaField({
  id,
  label,
  hint,
  value,
  onChange,
  words,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  words: number;
  disabled: boolean;
}) {
  const short = words > 0 && words < MIN_WORDS;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          {label}
        </label>
        <span
          className={`tabular font-mono text-xs ${
            short ? "text-amber-700 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>

      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={10}
        aria-describedby={`${id}-hint`}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-800 transition-colors duration-200 placeholder:text-slate-400 focus-visible:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand)] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-600"
        placeholder={`Paste the ${label.toLowerCase()} here…`}
      />

      <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {hint}
      </p>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="h-48 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-40 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-40 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}
