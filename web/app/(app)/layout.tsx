"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { NAV_ITEMS } from "@/lib/nav";

function ProductMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="product-mark" aria-label="ResumeAI">
      <span className="product-mark__icon">R</span>
      {!compact && <span>Resume<span className="product-mark__ai">AI</span></span>}
    </span>
  );
}

function UserGlyph({ small = false }: { small?: boolean }) {
  return <span className={`user-glyph ${small ? "user-glyph--small" : ""}`} aria-hidden="true"><i /></span>;
}

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    LayoutDashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    Briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></>,
    FileText: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    Users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 10 0v2M16 11a3 3 0 1 0 0-6M17 14a5 5 0 0 1 4 4v2" /></>,
    Mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    Settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  };
  return <svg className="side-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{paths[name]}</svg>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useUser();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const accent = localStorage.getItem("resumeai-accent") || "blue";
    const colors: Record<string, string> = {
      blue: "#adc6ff", gold: "#e9c349", silver: "#c8c6c7", purple: "#c4b5fd", coral: "#fda4af",
    };
    document.documentElement.style.setProperty("--accent-color", colors[accent] || colors.blue);
    document.documentElement.style.setProperty("--accent-color-hover", "#d8e2ff");
    document.documentElement.style.setProperty("--accent-glow", "rgba(173,198,255,.16)");
  }, [pathname]);

  const userName = user?.fullName || "Alex Sterling";
  const title = "Product Architect";

  const sidebar = (
    <>
      <div className="sidebar__brand"><Link href="/dashboard"><ProductMark /></Link></div>
      <div className="sidebar-profile">
        <UserGlyph />
        <div><strong>{userName}</strong><span>{title}</span></div>
      </div>
      <nav className="side-nav" aria-label="Workspace">
        <span className="side-nav__label">Workspace</span>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={active ? "side-nav__item is-active" : "side-nav__item"}>
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
              {item.href === "/outreach" && <small>3</small>}
            </Link>
          );
        })}
      </nav>
      <div className="sidebar__bottom">
        <div className="upgrade-card">
          <span>OBSIDIAN ACCESS</span>
          <strong>Turn every signal into an introduction.</strong>
          <button type="button">Explore Pro</button>
        </div>
        <Link className="sidebar-utility" href="/settings">? <span>Help Center</span></Link>
        <SignOutButton redirectUrl="/sign-in">
          <button className="sidebar-utility sidebar-utility--danger" type="button">↪ <span>Log out</span></button>
        </SignOutButton>
      </div>
    </>
  );

  return (
    <div className="obsidian-app">
      <aside className="app-sidebar">{sidebar}</aside>
      <header className="mobile-header">
        <Link href="/dashboard"><ProductMark /></Link>
        <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button>
      </header>
      {open && (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="mobile-drawer__backdrop" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <aside className="mobile-drawer__panel">
            <button className="mobile-drawer__close" onClick={() => setOpen(false)} aria-label="Close navigation">×</button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="app-stage">
        <main className="app-content" key={pathname}>{children}</main>
        <footer className="app-footer">
          <strong>ResumeAI Obsidian</strong>
          <span>Private career intelligence workspace</span>
          <nav><span>Privacy</span><span>Security</span><span>Support</span></nav>
        </footer>
      </div>
    </div>
  );
}
