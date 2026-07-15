"use client";
import { useEffect, useState } from "react";
import { nextTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as Theme | null);
    const initial: Theme = stored ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    apply(initial);
    // localStorage/matchMedia are unavailable during SSR, so the real theme
    // can only be read post-mount; deferring to an effect (rather than a
    // lazy useState initializer) avoids a hydration mismatch against the
    // server-rendered "dark" default. Single bounded correction, not a loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
  }, []);

  function apply(t: Theme) {
    document.documentElement.classList.toggle("dark", t === "dark");
    localStorage.setItem("theme", t);
  }

  function toggle() {
    const t = nextTheme(theme);
    setTheme(t);
    apply(t);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${nextTheme(theme)} mode`}
      className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      {theme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
