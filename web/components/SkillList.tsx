import { CheckCircleIcon, MinusCircleIcon, XCircleIcon } from "@/components/icons";

type Tone = "covered" | "missing" | "neutral";

const TONES: Record<
  Tone,
  { icon: typeof CheckCircleIcon; iconClass: string; srPrefix: string }
> = {
  covered: {
    icon: CheckCircleIcon,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    srPrefix: "Covered:",
  },
  missing: {
    icon: XCircleIcon,
    iconClass: "text-rose-600 dark:text-rose-400",
    srPrefix: "Missing:",
  },
  neutral: {
    icon: MinusCircleIcon,
    iconClass: "text-slate-400 dark:text-slate-500",
    srPrefix: "",
  },
};

export function SkillList({
  title,
  items,
  tone,
  emptyMessage,
}: {
  title: string;
  items: string[];
  tone: Tone;
  emptyMessage: string;
}) {
  const { icon: Icon, iconClass, srPrefix } = TONES[tone];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 flex items-baseline justify-between font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
        {title}
        <span className="tabular text-xs font-normal text-slate-500 dark:text-slate-400">
          {items.length}
        </span>
      </h3>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
              {/* Icon + text carry the meaning; colour alone never does. */}
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
              <span className="text-slate-700 dark:text-slate-300">
                {srPrefix && <span className="sr-only">{srPrefix} </span>}
                {item}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
