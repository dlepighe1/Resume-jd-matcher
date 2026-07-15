"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

export function NavMenu() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-6 text-sm">
      {NAV_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        if (item.comingSoon) {
          return (
            <span key={item.href} className="flex items-center gap-1.5 text-slate-500">
              {item.label}
              <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">soon</span>
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active
              ? "font-semibold text-[var(--color-brand)] underline decoration-2 underline-offset-8"
              : "text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
