export type NavItem = {
  label: string;
  href: string;
  icon: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  { label: "Applications", href: "/applications", icon: "Briefcase" },
  { label: "Resume", href: "/resumes", icon: "FileText" },
  { label: "Network", href: "/network", icon: "Users" },
  { label: "Outreach", href: "/outreach", icon: "Mail" },
  { label: "Settings", href: "/settings", icon: "Settings" },
] as const;

export function comingSoonHrefs(): string[] {
  return [];
}
