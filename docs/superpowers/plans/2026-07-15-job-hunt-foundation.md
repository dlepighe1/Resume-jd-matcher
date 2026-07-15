# Job-Hunt Foundation (Phase 1, Plan 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-page matcher demo into an authenticated app shell — Clerk sign-in (Google + email), a public landing page, a guarded dashboard with navbar/theme, and two "coming soon" screens.

**Architecture:** One Next.js 16 app. Route groups split public `(marketing)` from authed `(app)`. Clerk owns identity; a thin server helper (`lib/auth.ts`) resolves the Clerk `userId` for API routes, which keep using the existing service-role Supabase pattern. This plan ships the shell; Plan 2 moves the matcher's behavior in, Plan 3 adds the Applications data.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind 4, `@clerk/nextjs`, Supabase (service-role, server-only), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-job-hunt-platform-foundation-design.md`

---

## ⚠️ Read before coding

This is **not** the Next.js you may know (see `web/AGENTS.md`). Before writing framework-touching code:

1. Read `web/node_modules/next/dist/docs/` for current App Router, middleware, and route-group conventions.
2. After installing Clerk, read `web/node_modules/@clerk/nextjs/README.md` (and its `dist/` type declarations) for the **installed** version's API — `clerkMiddleware`, `<ClerkProvider>`, `auth()`, and the `<SignIn>/<SignUp>/<UserButton>` component names/props. **Do not trust API shapes from memory** — verify against the installed package and use exactly what it exports.

Where this plan shows Clerk/Next API calls, treat them as the *intended shape*; reconcile with the installed docs before finalizing each file.

All commands run from `web/`.

---

## File Structure

```
web/
  middleware.ts                       # CREATE — Clerk middleware; public marketing, guarded app
  .env.example                        # MODIFY — add Clerk keys
  app/
    layout.tsx                        # MODIFY — wrap in <ClerkProvider>
    (marketing)/
      page.tsx                        # CREATE — landing page (was app/page.tsx's slot)
      _components/Hero.tsx            # CREATE
      _components/FeatureGrid.tsx     # CREATE
      _components/ComingSoonTeaser.tsx# CREATE
    (app)/
      layout.tsx                      # CREATE — dashboard shell (navbar + theme), guarded
      matcher/page.tsx                # MOVE from app/page.tsx (behavior refined in Plan 2)
      compare/page.tsx                # MOVE from app/compare/page.tsx
      network/page.tsx                # CREATE — coming soon
      outreach/page.tsx               # CREATE — coming soon
    sign-in/[[...sign-in]]/page.tsx   # CREATE — Clerk <SignIn/>
    sign-up/[[...sign-up]]/page.tsx   # CREATE — Clerk <SignUp/>
    api/waitlist/route.ts             # CREATE — "Notify me" capture
  components/
    Navbar.tsx                        # CREATE — logo · menu · theme+avatar
    NavMenu.tsx                       # CREATE — menu items + active state + "soon" locks
    ThemeToggle.tsx                   # CREATE — light/dark, persisted
    ComingSoon.tsx                    # CREATE — reusable locked-screen body
  lib/
    auth.ts                           # CREATE — getUserIdOrNull / requireUserId
    auth.test.ts                      # CREATE
    nav.ts                            # CREATE — menu item config (single source of truth)
    nav.test.ts                       # CREATE
  supabase/schema.sql                 # MODIFY (repo root /supabase) — add waitlist table
```

---

## Task 1: Install and configure Clerk

**Files:**
- Modify: `web/package.json` (via install)
- Modify: `web/.env.example`
- Modify: `web/app/layout.tsx`
- Create: `web/middleware.ts`

- [ ] **Step 1: Install Clerk**

Run: `npm install @clerk/nextjs`
Expected: package added to `web/package.json` dependencies.

- [ ] **Step 2: Read the installed Clerk docs**

Read `web/node_modules/@clerk/nextjs/README.md` and confirm the exact exports for: the provider component, `clerkMiddleware`, `createRouteMatcher`, and `auth()` (server). Note anything that differs from the shapes below and prefer the installed API.

- [ ] **Step 3: Add Clerk env keys to `.env.example`**

Append:
```bash
# Clerk (auth). Create an app at https://dashboard.clerk.com, enable Google + email.
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```
Then create real values in `web/.env.local` (never committed). In the Clerk dashboard, enable **Google** and **email/password** only; leave other providers off.

- [ ] **Step 4: Wrap the root layout in `<ClerkProvider>`**

Modify `web/app/layout.tsx` — import the provider from `@clerk/nextjs` and wrap the existing `<html>…</html>` tree. Keep the Fira font variables and metadata intact. (Verify the provider's exact placement requirement in the installed README — some versions wrap `<html>`, others wrap `<body>`'s children.)

- [ ] **Step 5: Create `web/middleware.ts`**

Intended shape (reconcile with installed API):
```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything under (app) is private EXCEPT the matcher, which is usable as a guest.
const isProtected = createRouteMatcher([
  "/applications(.*)",
  "/network(.*)",
  "/outreach(.*)",
  "/compare(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
```

- [ ] **Step 6: Verify the app still boots**

Run: `npm run dev` and load `/`. Expected: no Clerk provider errors in the console. (A missing publishable key will error — set `.env.local` first.)

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/.env.example web/app/layout.tsx web/middleware.ts
git commit -m "feat(auth): install and wire Clerk provider + middleware"
```

---

## Task 2: Server auth helper (`lib/auth.ts`)

A single choke point for "who is the user" so every API route resolves identity the same way and no route forgets to scope by user. TDD — mock the Clerk server module.

**Files:**
- Create: `web/lib/auth.ts`
- Test: `web/lib/auth.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// web/lib/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));

import { getUserIdOrNull, requireUserId, UnauthorizedError } from "./auth";

beforeEach(() => authMock.mockReset());

describe("getUserIdOrNull", () => {
  it("returns the userId when signed in", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    expect(await getUserIdOrNull()).toBe("user_123");
  });
  it("returns null when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    expect(await getUserIdOrNull()).toBeNull();
  });
});

describe("requireUserId", () => {
  it("returns the userId when signed in", async () => {
    authMock.mockResolvedValue({ userId: "user_123" });
    expect(await requireUserId()).toBe("user_123");
  });
  it("throws UnauthorizedError when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL (module `./auth` not found).

- [ ] **Step 3: Implement `lib/auth.ts`**

```ts
// web/lib/auth.ts
import { auth } from "@clerk/nextjs/server";

/** Thrown by requireUserId when no user is signed in. API routes map this to 401. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "UnauthorizedError";
  }
}

/** The Clerk user id of the signed-in user, or null for guests. */
export async function getUserIdOrNull(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/** The Clerk user id, or throws UnauthorizedError. Use in routes that require sign-in. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserIdOrNull();
  if (!userId) throw new UnauthorizedError();
  return userId;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run lib/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/auth.ts web/lib/auth.test.ts
git commit -m "feat(auth): add server auth helper (getUserIdOrNull, requireUserId)"
```

---

## Task 3: Navigation config (`lib/nav.ts`)

Single source of truth for menu items — used by the navbar and to know which tabs are "coming soon". Pure data + a helper, easy to test.

**Files:**
- Create: `web/lib/nav.ts`
- Test: `web/lib/nav.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// web/lib/nav.test.ts
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, comingSoonHrefs } from "./nav";

describe("nav config", () => {
  it("has the four Phase-1 tabs in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Matcher", "Applications", "Network", "Outreach",
    ]);
  });
  it("marks Network and Outreach as coming soon", () => {
    expect(comingSoonHrefs()).toEqual(["/network", "/outreach"]);
  });
  it("Matcher is the default tab", () => {
    expect(NAV_ITEMS[0]).toMatchObject({ href: "/matcher", comingSoon: false });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run lib/nav.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/nav.ts`**

```ts
// web/lib/nav.ts
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
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run lib/nav.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/nav.ts web/lib/nav.test.ts
git commit -m "feat(nav): add navigation config as single source of truth"
```

---

## Task 4: Theme toggle component

Client component; persists to `localStorage` and toggles the `dark` class on `<html>` (Tailwind 4 dark mode). No network — logic is testable.

**Files:**
- Create: `web/components/ThemeToggle.tsx`
- Create: `web/lib/theme.ts` (pure helpers)
- Test: `web/lib/theme.test.ts`

- [ ] **Step 1: Write failing test for the pure helper**

```ts
// web/lib/theme.test.ts
import { describe, it, expect } from "vitest";
import { nextTheme, type Theme } from "./theme";

describe("nextTheme", () => {
  it("toggles light -> dark", () => { expect(nextTheme("light")).toBe("dark"); });
  it("toggles dark -> light", () => { expect(nextTheme("dark")).toBe("light"); });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run lib/theme.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/theme.ts`**

```ts
// web/lib/theme.ts
export type Theme = "light" | "dark";
export const nextTheme = (t: Theme): Theme => (t === "light" ? "dark" : "light");
```

- [ ] **Step 4: Run test, verify it passes** → PASS.

- [ ] **Step 5: Implement `ThemeToggle.tsx`**

```tsx
// web/components/ThemeToggle.tsx
"use client";
import { useEffect, useState } from "react";
import { nextTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem("theme") as Theme | null);
    const initial: Theme = stored ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    apply(initial);
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
```

- [ ] **Step 6: Confirm `globals.css` supports class-based dark mode**

Read `web/app/globals.css`. Tailwind 4 uses a `@custom-variant dark`/`@variant` config or the `dark:` variant against the `.dark` class. Ensure dark mode keys off the `.dark` class (add the custom variant if the file relies on `prefers-color-scheme`). Verify with the Tailwind 4 docs in `node_modules`.

- [ ] **Step 7: Commit**

```bash
git add web/lib/theme.ts web/lib/theme.test.ts web/components/ThemeToggle.tsx web/app/globals.css
git commit -m "feat(theme): add persisted light/dark toggle"
```

---

## Task 5: Navbar + NavMenu

**Files:**
- Create: `web/components/NavMenu.tsx`
- Create: `web/components/Navbar.tsx`

- [ ] **Step 1: Implement `NavMenu.tsx`**

Renders `NAV_ITEMS`. Live items are `<Link>`s with active styling (use `usePathname`); coming-soon items render disabled with a "soon" badge (no link). Reference the mockup: active = brand-green underline.

```tsx
// web/components/NavMenu.tsx
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
```

- [ ] **Step 2: Implement `Navbar.tsx`**

Logo left, `NavMenu` center, `ThemeToggle` + Clerk `<UserButton>` (with `<SignInButton>` fallback for guests) right. Verify Clerk component names against the installed README.

```tsx
// web/components/Navbar.tsx
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
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
        <SignedIn><UserButton /></SignedIn>
        <SignedOut>
          <SignInButton mode="modal">
            <button className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white">Sign in</button>
          </SignInButton>
        </SignedOut>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Manual check** — deferred until Task 6 renders the shell. No commit yet, or commit components alone:

```bash
git add web/components/NavMenu.tsx web/components/Navbar.tsx
git commit -m "feat(nav): add Navbar and NavMenu with coming-soon locks"
```

---

## Task 6: Route groups + dashboard shell + move existing pages

Establish `(marketing)` and `(app)` groups. Physically relocate the current matcher and compare pages so the app keeps working; Plan 2 refines the matcher's behavior.

**Files:**
- Create: `web/app/(app)/layout.tsx`
- Move: `web/app/page.tsx` → `web/app/(app)/matcher/page.tsx`
- Move: `web/app/compare/page.tsx` → `web/app/(app)/compare/page.tsx`
- Create: `web/app/sign-in/[[...sign-in]]/page.tsx`, `web/app/sign-up/[[...sign-up]]/page.tsx`

- [ ] **Step 1: Move the matcher page**

Move `web/app/page.tsx` to `web/app/(app)/matcher/page.tsx` unchanged (it's a client component; imports use the `@/` alias so paths still resolve). Route groups don't affect the URL, so this now serves `/matcher`.

- [ ] **Step 2: Move the compare page**

Move `web/app/compare/page.tsx` to `web/app/(app)/compare/page.tsx`. Update the internal `<Link href="/compare">` in the matcher page if needed (URL is unchanged, so likely fine).

- [ ] **Step 3: Create the dashboard shell layout**

```tsx
// web/app/(app)/layout.tsx
import { Navbar } from "@/components/Navbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create sign-in / sign-up pages**

```tsx
// web/app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return <div className="grid min-h-screen place-items-center p-6"><SignIn /></div>;
}
```
(Mirror for `sign-up` with `<SignUp />`.) Verify catch-all route syntax against the installed Next docs.

- [ ] **Step 5: Verify the dashboard renders**

Run: `npm run dev`, sign in, load `/matcher`. Expected: navbar shows (logo, menu with Network/Outreach locked, theme + avatar), matcher UI renders inside the shell. `/compare` works. Un-authed `/matcher` still renders (guest); `/applications` redirects to sign-in.

- [ ] **Step 6: Run the full test + lint suite**

Run: `npm run test && npm run lint`
Expected: existing tests still pass; no lint errors.

- [ ] **Step 7: Commit**

```bash
git add web/app
git commit -m "feat(shell): route groups + dashboard shell, move matcher/compare into (app)"
```

---

## Task 7: Coming-soon screens (Network, Outreach)

**Files:**
- Create: `web/components/ComingSoon.tsx`
- Create: `web/app/(app)/network/page.tsx`
- Create: `web/app/(app)/outreach/page.tsx`

- [ ] **Step 1: Implement reusable `ComingSoon.tsx`**

```tsx
// web/components/ComingSoon.tsx
export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="mb-4 text-4xl">🚧</div>
      <h1 className="mb-2 font-mono text-xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="text-slate-600 dark:text-slate-400">{children}</p>
    </div>
  );
}
```

- [ ] **Step 2: Implement the two pages**

```tsx
// web/app/(app)/network/page.tsx
import { ComingSoon } from "@/components/ComingSoon";
export default function Page() {
  return <ComingSoon title="Network — coming soon">Map the people and hierarchy behind a company, with contacts you can reach. We&apos;re designing this to use compliant data sources, not scraping.</ComingSoon>;
}
```
(Mirror for `outreach/page.tsx`: "Compose and send cold-outreach emails to your contacts, with tracking that advances your applications automatically.")

- [ ] **Step 3: Verify** — load `/network` and `/outreach` while signed in; both show the locked screen. Signed-out access redirects to sign-in (they're in `isProtected`).

- [ ] **Step 4: Commit**

```bash
git add web/components/ComingSoon.tsx web/app/(app)/network web/app/(app)/outreach
git commit -m "feat(app): add Network and Outreach coming-soon screens"
```

---

## Task 8: Waitlist API ("Notify me")

Backs the landing page's coming-soon capture. Server route → Supabase. TDD the route's validation using the existing route-test style in `web/app/api/*/route.test.ts`.

**Files:**
- Modify: `supabase/schema.sql` (repo root)
- Create: `web/app/api/waitlist/route.ts`
- Test: `web/app/api/waitlist/route.test.ts`

- [ ] **Step 1: Add the waitlist table to `supabase/schema.sql`**

```sql
create table if not exists waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  feature    text not null check (feature in ('network','outreach','general')),
  created_at timestamptz not null default now()
);
alter table waitlist enable row level security;  -- writes go through the server (service-role) only
```
Run it in the Supabase SQL editor (or `supabase db push`).

- [ ] **Step 2: Write failing tests**

Follow the existing pattern in `web/app/api/share/[id]/route.test.ts` (inspect it first). Test: rejects invalid email (400), rejects unknown feature (400), inserts valid payload (200). Mock the Supabase client the same way existing route tests do (check `web/lib/db.ts` for the client factory to mock).

- [ ] **Step 3: Run tests, verify they fail** → FAIL.

- [ ] **Step 4: Implement `route.ts`**

Use `zod` (already a dependency) to validate `{ email, feature }`; insert via the server Supabase client from `lib/db.ts` (using `env.supabase.serviceRoleKey`). Return `{ ok: true }` on success. Reference `web/app/api/share/[id]/route.ts` for the response/error conventions and `web/lib/errors.ts`.

- [ ] **Step 5: Run tests, verify they pass** → PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql web/app/api/waitlist/route.ts web/app/api/waitlist/route.test.ts
git commit -m "feat(waitlist): add Notify-me capture API + waitlist table"
```

---

## Task 9: Landing page

**Files:**
- Create: `web/app/(marketing)/page.tsx`
- Create: `web/app/(marketing)/_components/Hero.tsx`
- Create: `web/app/(marketing)/_components/FeatureGrid.tsx`
- Create: `web/app/(marketing)/_components/ComingSoonTeaser.tsx`

- [ ] **Step 1: Hero**

`Hero.tsx`: headline ("Smarter matches. Clearer insights. Better opportunities."), subcopy, two CTAs — **Sign up** (`href="/sign-up"`) and **Try the Matcher** (`href="/matcher"`). Match the existing brand CSS vars and Fira fonts.

- [ ] **Step 2: FeatureGrid**

Three cards: *3 engines, one verdict* (mention **0.86 Spearman / 0.10 MAE on 106 held-out pairs**), *Match score + strengths & gaps*, *Applications pipeline tracker*. Pull real numbers from the spec — do not invent metrics.

- [ ] **Step 3: ComingSoonTeaser**

Two teasers (Network, Outreach) each with a one-line description and an email input that POSTs to `/api/waitlist` with the right `feature`. Show a success state on 200. Reuse the fetch pattern from `app/(app)/matcher/page.tsx`.

- [ ] **Step 4: Assemble `page.tsx`**

Compose Hero + FeatureGrid + ComingSoonTeaser + a short footer (seed the compliance note: outreach will follow CAN-SPAM/GDPR). This page is public (outside `(app)`), so no auth.

- [ ] **Step 5: Verify** — load `/` signed-out: landing renders, "Try the Matcher" reaches `/matcher`, "Sign up" reaches Clerk, "Notify me" returns success and a row lands in `waitlist`.

- [ ] **Step 6: Run test + lint + build**

Run: `npm run test && npm run lint && npm run build`
Expected: all green (the build catches route-group / server-client boundary mistakes).

- [ ] **Step 7: Commit**

```bash
git add web/app/(marketing)
git commit -m "feat(marketing): landing page with hero, features, coming-soon capture"
```

---

## Definition of Done (Plan 1)

- [ ] Signed-out `/` shows the landing page; `/matcher` works as a guest; `/applications`, `/network`, `/outreach`, `/compare` redirect to sign-in.
- [ ] Sign-up/in with Google or email works; the navbar shows the user avatar when signed in.
- [ ] Navbar: logo left, menu center (Matcher/Applications live, Network/Outreach locked), theme + avatar right. Theme toggle persists.
- [ ] `npm run test`, `npm run lint`, and `npm run build` all pass.
- [ ] No secret keys committed; `.env.example` documents the new Clerk vars.

**Next:** Plan 2 (matcher behavior: on-demand single-engine runs, engine picker, Save-to-Applications) and Plan 3 (resumes + applications tables, table view with inline status).
