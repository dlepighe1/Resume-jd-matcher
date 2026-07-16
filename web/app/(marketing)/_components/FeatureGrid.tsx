import { CheckCircleIcon, SparklesIcon, TrendingUpIcon } from "@/components/icons";

const FEATURES = [
  {
    icon: TrendingUpIcon,
    title: "3 engines, one verdict",
    description:
      "Compare a fine-tuned matching model against general-purpose LLMs on the same resume/job pair — validated at 0.86 Spearman correlation and 0.10 MAE on 106 held-out pairs from unseen postings.",
  },
  {
    icon: SparklesIcon,
    title: "Match score + strengths & gaps",
    description:
      "Get a single match score alongside the specific requirements a resume covers and the ones it's missing — so you know exactly what to fix before you apply.",
  },
  {
    icon: CheckCircleIcon,
    title: "Applications pipeline tracker",
    description:
      "Keep every application, its match score, and its status in one place, from saved to interviewing to offer — instead of scattered spreadsheets and email threads.",
  },
] as const;

export function FeatureGrid() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <div
            key={title}
            className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <Icon className="h-6 w-6 text-[var(--color-brand)]" />
            <h2 className="mt-4 font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
