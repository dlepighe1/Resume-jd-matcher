import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { NavMenu } from "./NavMenu";
import { ThemeToggle } from "./ThemeToggle";

export function Navbar() {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
      <Link href="/matcher" className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-brand)] text-xs font-extrabold text-slate-950">AI</span>
        <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">ResumeAI</span>
      </Link>
      <NavMenu />
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <Show
          when="signed-in"
          fallback={
            <SignInButton mode="modal" fallbackRedirectUrl="/matcher">
              <button className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white">Sign in</button>
            </SignInButton>
          }
        >
          <UserButton />
        </Show>
      </div>
    </header>
  );
}
