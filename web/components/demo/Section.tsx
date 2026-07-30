import type { ReactNode } from "react";

/**
 * One page section, with a plain-language lead and optional technical depth behind a
 * disclosure.
 *
 * This is how the page serves three audiences without three versions of itself. A
 * recruiter reads the lead and stops. A non-technical visitor reads the lead and the
 * body. Someone who wants the evidence opens `<Detail>`. Nobody is shown a "simplified
 * mode" that hides what the numbers actually are, and nobody has to wade through
 * bootstrap intervals to find out whether the tool works.
 */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t px-5 py-14 sm:px-8" style={{ borderColor: "var(--hairline)" }}>
      <div className="mx-auto max-w-5xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        {lead && (
          <div className="mt-3 max-w-3xl text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {lead}
          </div>
        )}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

/** Technical depth, collapsed by default. Open one and the rest stay closed 
 *  it's a reference, not a reading order. */
export function Detail({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details
      className="group mt-4 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }}
    >
      <summary
        className="cursor-pointer list-none text-sm font-medium marker:content-none"
        style={{ color: "var(--text-primary)" }}
      >
        <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">
          ›
        </span>
        {summary}
      </summary>
      <div
        className="mt-3 space-y-3 text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {children}
      </div>
    </details>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border p-5 ${className}`}
      style={{ borderColor: "var(--hairline)", background: "var(--surface-1)" }}
    >
      {children}
    </div>
  );
}

/** A single measured number. `basis` is required, a figure on this page always says
 *  where it came from. */
export function Stat({
  value,
  label,
  basis,
  accent = false,
}: {
  value: string;
  label: string;
  basis: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-3xl font-semibold tracking-tight"
        style={{ color: accent ? "var(--series-1)" : "var(--text-primary)" }}
      >
        {value}
      </div>
      <div className="mt-1 text-sm font-medium">{label}</div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
        {basis}
      </div>
    </div>
  );
}
