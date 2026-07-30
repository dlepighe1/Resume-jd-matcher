"use client";

import { useState } from "react";
import type { ScoreResponse } from "@/app/api/score/route";
import type { KeywordGap } from "@/lib/ats";
import { bandFor } from "@/lib/benchmark";
import { EXAMPLE_JD, EXAMPLE_RESUME } from "@/lib/examples";
import { MIN_WORDS, wordCount } from "@/lib/types";
import { Card } from "@/components/demo/Section";

/**
 * Score one resume and job description with every engine that is configured.
 *
 * The comparison is the feature. A single score tells a visitor nothing about whether to
 * trust it. The same pair scored by the fine-tuned model, by the same architecture without
 * fine-tuning, and by a literal keyword matcher shows what each approach can and cannot see.
 */
export function LiveScorer({ serviceConfigured }: { serviceConfigured: boolean }) {
  const [jd, setJd] = useState("");
  const [resume, setResume] = useState("");
  const [includeClaude, setIncludeClaude] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jdWords = wordCount(jd);
  const resumeWords = wordCount(resume);
  const ready = jdWords >= MIN_WORDS && resumeWords >= MIN_WORDS;

  async function run() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: jd, resumeText: resume, includeClaude }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "The request could not be completed.");
        setState("error");
        return;
      }
      setResult(body as ScoreResponse);
      setState("done");
    } catch {
      setError("Could not reach the server. Check that the app is running.");
      setState("error");
    }
  }

  return (
    <div className="space-y-6">
      {!serviceConfigured && (
        <div
          className="rounded-xl border px-4 py-3 text-sm leading-relaxed"
          style={{ borderColor: "var(--status-warning)", background: "var(--surface-1)" }}
        >
          <strong>The scoring service is not connected.</strong> Live scoring requires the Python
          service to be running, with its address in <code className="text-xs">SCORING_SERVICE_URL</code>.
          The benchmark further down is precomputed and works either way, and it is the part with
          published evidence behind it.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Field
          label="Job description"
          words={jdWords}
          value={jd}
          onChange={setJd}
          placeholder="Paste a job posting"
        />
        <Field
          label="Resume"
          words={resumeWords}
          value={resume}
          onChange={setResume}
          placeholder="Paste a resume"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={!ready || state === "loading" || !serviceConfigured}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          style={{ background: "var(--series-1)" }}
        >
          {state === "loading" ? "Scoring" : "Score this pair"}
        </button>

        <button
          type="button"
          onClick={() => {
            setJd(EXAMPLE_JD);
            setResume(EXAMPLE_RESUME);
          }}
          className="rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "var(--hairline)" }}
        >
          Load an example
        </button>

        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <input
            type="checkbox"
            checked={includeClaude}
            onChange={(e) => setIncludeClaude(e.target.checked)}
          />
          Include Claude
          <span style={{ color: "var(--text-muted)" }}>(requires an API key, costs one call)</span>
        </label>

        {!ready && (jdWords > 0 || resumeWords > 0) && (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Both fields need at least {MIN_WORDS} words.
          </span>
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Nothing you paste is stored. This repository has no database. Text is scored in memory and
        discarded when the request completes.
      </p>

      {state === "loading" && (
        <Card>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Scoring in progress. If the service has been idle it may be starting up and loading
            roughly 420 MB of weights, which can take up to a minute on the first request. The
            base-model comparison loads a second model the first time it is requested.
          </p>
        </Card>
      )}

      {state === "error" && (
        <Card>
          <p className="text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        </Card>
      )}

      {state === "done" && result && <LiveResults result={result} />}
    </div>
  );
}

function Field({
  label,
  words,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  words: number;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-sm font-medium">
        {label}
        <span
          className="tnum text-xs"
          style={{ color: words >= MIN_WORDS ? "var(--text-muted)" : "var(--status-warning)" }}
        >
          {words} words
        </span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={10}
        className="mt-2 w-full resize-y rounded-xl border p-3 text-sm"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface-1)",
          color: "var(--text-primary)",
        }}
      />
    </label>
  );
}

function LiveResults({ result }: { result: ScoreResponse }) {
  const ft = result.finetuned?.ok ? result.finetuned.value : null;
  const base = result.baseline?.ok ? result.baseline.value : null;
  const claude = result.claude?.ok ? result.claude.value : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ft && (
          <ScoreCard
            title="Fine-tuned model"
            score={ft.matchScore}
            suffix="/100"
            band={bandFor(ft.matchScore / 100).label}
            note={
              ft.errorBand
                ? `Calibrated. Typically within ${Math.round((ft.errorBand.high - ft.errorBand.low) / 2)} points on pairs it has not seen.`
                : "Calibrated against held-out data."
            }
            accent
          />
        )}
        {base && (
          <ScoreCard
            title="Same model, no fine-tuning"
            score={Math.round(base.rawCosine * 100)}
            suffix="/100"
            band="Raw similarity"
            note="Not calibrated. This is a cosine similarity, not a percentage match. Compare its ordering against the fine-tuned model, not its value."
          />
        )}
        {result.ats && (
          <ScoreCard
            title="Keyword coverage"
            score={result.ats.score}
            suffix="%"
            band="No model involved"
            note={`${result.ats.matched.length} of ${result.ats.matched.length + result.ats.missing.length} skills named in the posting appear verbatim in the resume.`}
          />
        )}
        {claude && (
          <ScoreCard
            title="Claude"
            score={claude.matchScore}
            suffix="/100"
            band={bandFor(claude.matchScore / 100).label}
            note="Uncalibrated. A general-purpose model answering zero-shot."
          />
        )}
      </div>

      {failures(result).map(({ name, message }) => (
        <Card key={name}>
          <p className="text-sm">
            <strong>{name}</strong> did not run.{" "}
            <span style={{ color: "var(--text-secondary)" }}>{message}</span>
          </p>
        </Card>
      ))}

      {result.ats && <KeywordPanel ats={result.ats} />}

      {ft && (ft.matchedSkills.length > 0 || ft.missingSkills.length > 0) && (
        <Card>
          <h4 className="text-sm font-semibold">Requirement coverage</h4>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            The fine-tuned model compares each requirement in the posting against the resume
            separately. This is semantic, so it credits evidence written in different words than
            the posting uses. It cannot write prose about what it finds, because it is an
            embedding model rather than a language model.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <RequirementList
              title="Evidenced"
              tone="var(--status-good)"
              items={ft.matchedSkills}
              empty="No stated requirement was matched to resume content."
            />
            <RequirementList
              title="Not evidenced"
              tone="var(--status-critical)"
              items={ft.missingSkills}
              empty="Every stated requirement was matched."
            />
          </div>
          {ft.strengths.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                Resume lines the model matched against
              </div>
              <ul className="mt-1 space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {ft.strengths.map((s, i) => (
                  <li key={i}>{s.slice(0, 180)}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {claude?.summary && (
        <Card>
          <h4 className="text-sm font-semibold">Claude&rsquo;s written assessment</h4>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {claude.summary}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Written by a general-purpose language model. The fine-tuned model produces no prose,
            and this section is absent when Claude is not included.
          </p>
        </Card>
      )}
    </div>
  );
}

/**
 * Which keywords the posting asks for, which the resume already has, and which gaps matter
 * most.
 *
 * Priority comes from the posting alone: how often a skill is named, and whether it appears
 * in the requirements section rather than only in the company description. It is not a
 * prediction of how far the score would move, because that was never measured.
 */
function KeywordPanel({ ats }: { ats: NonNullable<ScoreResponse["ats"]> }) {
  const high = ats.gaps.filter((g) => g.priority === "high");
  const rest = ats.gaps.filter((g) => g.priority !== "high");

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold">Keywords</h4>
        <span className="tnum text-xs" style={{ color: "var(--text-muted)" }}>
          {ats.score}% literal coverage
        </span>
      </div>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Applicant tracking systems filter on literal string matches, so this is a different
        signal from the semantic score rather than a worse one. A resume can be a strong
        semantic fit and still be filtered out for saying &ldquo;orchestration tooling&rdquo;
        where the posting says &ldquo;Airflow&rdquo;.
      </p>

      {ats.gaps.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Gaps worth closing first
          </div>
          <div className="scroll-x mt-2">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="py-1.5 pr-4 text-xs font-medium">Skill</th>
                  <th className="py-1.5 pr-4 text-xs font-medium">Priority</th>
                  <th className="py-1.5 pr-4 text-xs font-medium">Times named</th>
                  <th className="py-1.5 text-xs font-medium">Where</th>
                </tr>
              </thead>
              <tbody>
                {ats.gaps.map((gap) => (
                  <GapRow key={gap.keyword} gap={gap} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 max-w-3xl text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {high.length > 0 ? (
              <>
                <strong>
                  {high.map((g) => g.keyword).join(", ")}
                </strong>{" "}
                {high.length === 1 ? "is named" : "are named"} more than once inside the
                requirements section and {high.length === 1 ? "does" : "do"} not appear in the
                resume. If the experience exists, naming it in the posting&rsquo;s own vocabulary
                is the highest-value edit.
              </>
            ) : rest.length > 0 ? (
              <>
                No skill is both repeated and located in the requirements section, so these gaps
                are secondary. Closing them helps with keyword filters more than with the match
                score.
              </>
            ) : null}
          </p>

          <p className="mt-2 max-w-3xl text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            One caution. Adding a keyword the resume cannot evidence produces exactly the pattern
            this model was trained to catch: keyword-dense, wrong-role resumes appear in the
            training data as hard negatives, and the model scores them low on purpose. Keyword
            coverage rises, the match score does not.
          </p>
        </div>
      )}

      {ats.matched.length > 0 && (
        <div className="mt-5">
          <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            Already covered
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ats.matched.map((k) => (
              <li
                key={k}
                className="rounded-md border px-2 py-0.5 text-xs"
                style={{ borderColor: "var(--hairline)", color: "var(--text-secondary)" }}
              >
                {k}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function GapRow({ gap }: { gap: KeywordGap }) {
  const tone =
    gap.priority === "high"
      ? "var(--status-critical)"
      : gap.priority === "medium"
        ? "var(--status-warning)"
        : "var(--text-muted)";

  return (
    <tr className="border-t" style={{ borderColor: "var(--hairline)" }}>
      <td className="py-2 pr-4" style={{ color: "var(--text-primary)" }}>
        {gap.keyword}
      </td>
      <td className="py-2 pr-4">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: tone }}
            aria-hidden="true"
          />
          {gap.priority}
        </span>
      </td>
      <td className="tnum py-2 pr-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        {gap.occurrences}
      </td>
      <td className="py-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        {gap.inRequirements ? "Requirements section" : "Elsewhere in the posting"}
      </td>
    </tr>
  );
}

/**
 * Engines that were attempted and failed. An engine that was never configured is not a
 * failure, so it is reported by the panel above rather than here.
 */
function failures(result: ScoreResponse): { name: string; message: string }[] {
  const entries = [
    ["Fine-tuned model", result.finetuned],
    ["Base model", result.baseline],
    ["Claude", result.claude],
  ] as const;

  return entries.flatMap(([name, outcome]) =>
    outcome && !outcome.ok ? [{ name, message: outcome.message }] : [],
  );
}

function RequirementList({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: string;
  items: string[];
  empty: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: tone }} aria-hidden="true" />
        {title}
        <span className="tnum" style={{ color: "var(--text-muted)" }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {empty}
        </p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScoreCard({
  title,
  score,
  suffix,
  band,
  note,
  accent = false,
}: {
  title: string;
  score: number;
  suffix: string;
  band: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </div>
      <div
        className="mt-1 text-3xl font-semibold tracking-tight"
        style={{ color: accent ? "var(--series-1)" : "var(--text-primary)" }}
      >
        {score}
        <span className="text-base font-normal" style={{ color: "var(--text-muted)" }}>
          {suffix}
        </span>
      </div>
      <div className="mt-1 text-sm font-medium">{band}</div>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {note}
      </p>
    </Card>
  );
}
