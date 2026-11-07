"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { getPlan, getState, quotaStatus } from "@/lib/data/store";
import { buttonClass } from "@/components/ui/primitives";

export function SkipLink() {
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 bg-ink text-on-ink px-3 py-2 rounded-md">
      Skip to content
    </a>
  );
}

const NAV = [
  { href: "/", label: "Remove watermark" },
  { href: "/pricing", label: "Pricing" },
  { href: "/account", label: "Your videos" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-bold text-lg shrink-0">
      <span className="size-8 rounded-md bg-accent text-on-accent grid place-items-center text-sm" aria-hidden>C</span>
      <span>Cleanup<span className="sr-only"> home</span></span>
    </Link>
  );
}

export function QuotaMeter({ compact = false }: { compact?: boolean }) {
  const { hydrated } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !hydrated) return null;
  const q = quotaStatus();
  if (q.previewsLeft === 0)
    return (
      <p className="text-xs text-warning tabnums">
        No previews left today. Resets in {q.resetsInHours} h. <Link href="/pricing" className="underline">See plans</Link>
      </p>
    );
  return (
    <p className="text-xs text-text-muted tabnums">
      {q.previewsLeft} of {q.previewsCap} {compact ? "previews" : `${getPlan().id === "guest" ? "free " : ""}previews left today`} · resets in {q.resetsInHours} h
    </p>
  );
}

function AccountLink() {
  useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const profile = mounted ? getState().profile : null;
  if (profile && !profile.isAnonymous)
    return <Link href="/account" className={buttonClass("outline", "sm", "rounded-pill min-w-0 max-w-[120px] sm:max-w-[180px]")}><span className="truncate">{profile.email ?? "Account"}</span></Link>;
  return <Link href="/login" className={buttonClass("secondary", "sm", "rounded-pill")}>{profile ? "Save work" : "Log in"}</Link>;
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="border-b border-border bg-bg sticky top-0 z-30">
      <div className="mx-auto max-w-page px-4 lg:px-8 h-14 flex items-center gap-3 sm:gap-6">
        <Logo />
        <nav aria-label="Main" className="hidden lg:flex gap-6 text-sm font-medium text-text-muted">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} className="hover:text-text aria-[current=page]:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto min-w-0 flex items-center gap-3">
          <div className="hidden md:block"><QuotaMeter /></div>
          <AccountLink />
          <button className="lg:hidden size-10 grid place-items-center rounded-md hover:bg-surface-hover" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>
            {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="lg:hidden border-t border-border bg-bg px-4 py-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="flex items-center h-12 text-base font-medium" aria-current={path === n.href ? "page" : undefined}>{n.label}</Link>
          ))}
          <div className="py-3 md:hidden"><QuotaMeter /></div>
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface mt-24">
      <div className="mx-auto max-w-page px-4 lg:px-8 py-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-text-muted">
        <Link href="/legal/terms" className="hover:text-text">Terms</Link>
        <Link href="/legal/privacy" className="hover:text-text">Privacy</Link>
        <Link href="/legal/takedown" className="hover:text-text">Copyright &amp; takedown</Link>
        <button className="hover:text-text" onClick={() => window.dispatchEvent(new Event("cleanup:cookies"))}>Cookie settings</button>
        <span className="sm:ml-auto">© {new Date().getFullYear()} Cleanup (working name)</span>
      </div>
    </footer>
  );
}

const COOKIE_KEY = "cleanup.cookies";

export function CookieBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!localStorage.getItem(COOKIE_KEY)); } catch { setShow(true); }
    const reopen = () => setShow(true);
    window.addEventListener("cleanup:cookies", reopen);
    return () => window.removeEventListener("cleanup:cookies", reopen);
  }, []);
  if (!show) return null;
  const choose = (v: "essential" | "all") => {
    try { localStorage.setItem(COOKIE_KEY, v); } catch { /* ignore */ }
    setShow(false);
  };
  return (
    <div role="region" aria-label="Cookie choices" className="fixed z-40 bottom-4 inset-x-4 mx-auto max-w-[720px] bg-surface-raised border border-border rounded-xl shadow-pop p-4 flex flex-col md:flex-row md:items-center gap-3 text-sm">
      <p className="flex-1 text-text-muted">We only use what the site needs to work. With your OK we&apos;d also count visits, without ads or tracking across sites.</p>
      <div className="flex gap-2">
        <button className={buttonClass("outline", "md")} onClick={() => choose("essential")}>Only essential</button>
        <button className={buttonClass("outline", "md")} onClick={() => choose("all")}>Allow counting</button>
      </div>
    </div>
  );
}
