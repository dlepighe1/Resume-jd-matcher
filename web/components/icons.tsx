/**
 * Inline SVG icons (Lucide paths, 24x24, stroke 2, currentColor).
 *
 * Deliberately not emoji: emoji render differently per platform, can't be themed,
 * and are announced by screen readers as their unicode name. These are decorative
 * by default (aria-hidden) — every icon in this app sits next to a text label that
 * carries the actual meaning.
 */

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function XCircleIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </Svg>
  );
}

export function MinusCircleIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
    </Svg>
  );
}

export function SparklesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.94 4.94 9 2l-.94 2.94a2 2 0 0 1-1.12 1.12L4 7l2.94.94a2 2 0 0 1 1.12 1.12L9 12l.94-2.94a2 2 0 0 1 1.12-1.12L14 7l-2.94-.94a2 2 0 0 1-1.12-1.12Z" />
      <path d="M18 10.5 17.5 9l-.5 1.5-1.5.5 1.5.5.5 1.5.5-1.5 1.5-.5Z" />
      <path d="m15 18-1-3-1 3-3 1 3 1 1 3 1-3 3-1Z" />
    </Svg>
  );
}

export function TrendingUpIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16 7h6v6" />
      <path d="m22 7-8.5 8.5-5-5L2 17" />
    </Svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Svg>
  );
}
