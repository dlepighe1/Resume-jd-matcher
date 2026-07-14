"use client";

import { PROVIDERS, PROVIDER_META, type ProviderId } from "@/lib/types";

/**
 * Native radio inputs, visually restyled as cards. Keeps arrow-key navigation,
 * focus rings, and screen-reader grouping for free — a div-with-onClick would
 * throw all of that away.
 */
export function ProviderSelect({
  value,
  onChange,
  disabled,
}: {
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="disabled:opacity-60">
      <legend className="mb-2 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
        Engine
      </legend>

      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((id) => {
          const meta = PROVIDER_META[id];
          const selected = value === id;

          return (
            <label
              key={id}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors duration-200 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-brand)] ${
                selected
                  ? "border-[var(--color-brand)] bg-blue-50 dark:bg-blue-950/40"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              }`}
            >
              <input
                type="radio"
                name="provider"
                value={id}
                checked={selected}
                onChange={() => onChange(id)}
                className="sr-only"
              />
              <span className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                {meta.name}
              </span>
              <span className="text-xs leading-snug text-slate-600 dark:text-slate-400">
                {meta.tagline}
              </span>
              {!meta.capabilities.generativeFeedback && (
                <span className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-500">
                  score + gaps only
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
