export type NavItem = {
  label: string;
  href: string;
  comingSoon: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Matcher", href: "/matcher", comingSoon: false },
  { label: "Applications", href: "/applications", comingSoon: false },
  { label: "Network", href: "/network", comingSoon: true },
  { label: "Outreach", href: "/outreach", comingSoon: true },
] as const;

export function comingSoonHrefs(): string[] {
  return NAV_ITEMS.filter((i) => i.comingSoon).map((i) => i.href);
}
