"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";

export function NavMenu() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-6 text-sm">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
