"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { APPS, AppId, getApp } from "@/lib/apps";

// Header brand for an app page: a Home link, the current app's name, and a menu to jump to another app.
export function AppSwitcher({ current }: { current: AppId }) {
  const app = getApp(current);
  const others = APPS.filter((a) => a.id !== current);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex shrink-0 items-center gap-2">
      <Link
        href="/"
        aria-label="Home"
        title="All apps"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-gold/40 hover:text-gold"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5" />
        </svg>
      </Link>
      <Link href={app.href} className="font-bold uppercase tracking-[.2em] text-gold">
        {app.name}
      </Link>
      {others.length > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Switch app"
          aria-expanded={open}
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <svg className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-panel shadow-2xl">
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Switch to</p>
          {others.map((a) => (
            <Link
              key={a.id}
              href={a.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 text-sm text-white/85 transition hover:bg-white/5 hover:text-gold"
            >
              <span className="text-lg">{a.icon}</span>
              {a.name}
            </Link>
          ))}
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="block border-t border-white/10 px-3 py-2.5 text-xs text-white/60 transition hover:bg-white/5 hover:text-gold"
          >
            All apps →
          </Link>
        </div>
      )}
    </div>
  );
}
