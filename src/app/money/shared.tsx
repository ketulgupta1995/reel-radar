"use client";

// Pieces shared by the Money app's pages.

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { AppSwitcher } from "@/components/AppSwitcher";
import { CATEGORIES, KINDS, ME, categoryOf, type CategoryId, type Kind, type Person } from "@/lib/money";

export const inr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const formatMonth = (month: string) =>
  new Date(month + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

export const formatDay = (date: string) =>
  new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// "Thu, Oct 5"
export const formatWeekday = (date: string) =>
  new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// "14:05" → "2:05 PM"
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const personName = (people: Person[], id: string) => people.find((p) => p.id === id)?.name ?? "Removed person";

export const FIELD =
  "rounded-xl border border-white/10 bg-white/[.06] px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-gold/50 focus:bg-white/[.09]";
export const SMALL_SELECT = "rounded-lg border border-white/10 bg-panel px-2 py-1.5 text-xs text-white/85 outline-none focus:border-gold/50";
export const CARD = "rounded-3xl border border-white/10 bg-white/[.04] p-4 shadow-xl shadow-black/20 backdrop-blur-xl sm:p-5";
export const CHIP = "rounded-full border px-3 py-1 text-xs transition";
export const chipState = (on: boolean) => (on ? "border-gold/50 bg-gold/15 text-gold" : "border-white/10 text-white/65 hover:border-white/25 hover:text-white");

const TABS = [
  { id: "overview", label: "Overview", href: "/money" },
  { id: "import", label: "Import", href: "/money/import" },
  { id: "settings", label: "Settings", href: "/money/settings" },
] as const;

// The page frame: soft glow background, sticky glass header with the tabs.
export function MoneyShell({ active, children, wide = true }: { active: (typeof TABS)[number]["id"]; children?: ReactNode; wide?: boolean }) {
  return (
    <main className="relative min-h-screen bg-ink text-white">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.10),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(246,196,83,0.10),transparent_55%),radial-gradient(ellipse_at_top_right,rgba(56,189,248,0.06),transparent_50%)]"
      />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/60 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <AppSwitcher current="money" />
          <div className="flex gap-1 rounded-full border border-white/10 bg-white/[.04] p-1 text-sm">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={t.id === active ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 transition ${t.id === active ? "bg-gold text-ink font-semibold" : "text-white/70 hover:text-white"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      {children && <div className={`relative mx-auto ${wide ? "max-w-5xl" : "max-w-3xl"} space-y-5 px-4 pb-28 pt-5 sm:px-6 sm:pt-8`}>{children}</div>}
    </main>
  );
}

// Each person keeps one color, picked by their place in the list (you are always the first).
const AVATAR_COLORS = ["bg-gold/20 text-gold", "bg-sky-400/20 text-sky-300", "bg-violet-400/20 text-violet-300", "bg-emerald-400/20 text-emerald-300", "bg-rose-400/20 text-rose-300", "bg-orange-400/20 text-orange-300"];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function Avatar({ person, people, size = "md" }: { person: Person; people: Person[]; size?: "sm" | "md" | "lg" }) {
  const color = AVATAR_COLORS[Math.max(0, people.findIndex((p) => p.id === person.id)) % AVATAR_COLORS.length];
  const dims = size === "lg" ? "h-11 w-11 text-sm" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dims} ${color}`}>
      {person.id === ME ? "You" : initials(person.name)}
    </span>
  );
}

export function CategoryIcon({ id, muted = false }: { id: CategoryId; muted?: boolean }) {
  return (
    <span aria-hidden className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-base ${muted ? "bg-white/[.03] grayscale" : "bg-white/[.07]"}`}>
      {categoryOf(id).icon}
    </span>
  );
}

export function CategorySelect({ value, onChange, label }: { value: CategoryId; onChange: (c: CategoryId) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as CategoryId)} className={SMALL_SELECT}>
      {CATEGORIES.map((c) => (
        <option key={c.id} value={c.id}>
          {c.icon} {c.label}
        </option>
      ))}
    </select>
  );
}

export function KindSelect({ value, onChange, label }: { value: Kind; onChange: (k: Kind) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Kind)} className={SMALL_SELECT}>
      {KINDS.map((k) => (
        <option key={k.id} value={k.id}>
          {k.label}
        </option>
      ))}
    </select>
  );
}

// Which family member a "Paid back" was sent to.
export function PaidToSelect({ value, people, onChange, label }: { value: string; people: Person[]; onChange: (id: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={SMALL_SELECT}>
      {!people.some((p) => p.id === value) && (
        <option value={value} disabled>
          To whom?
        </option>
      )}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          To {p.name}
        </option>
      ))}
    </select>
  );
}

// A progress bar; amber near `limit`, red past it.
export function Meter({ value, limit, label, thick = false }: { value: number; limit: number; label: string; thick?: boolean }) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (value / limit) * 100)) : 0;
  const over = value > limit;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.round(limit)}
      className={`${thick ? "h-2.5" : "h-1.5"} overflow-hidden rounded-full bg-white/10`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${over ? "bg-red-500" : pct > 85 ? "bg-amber-400" : "bg-gradient-to-r from-gold/70 to-gold"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// A panel that slides up from the bottom on phones and sits centered on wider screens.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="dialog" aria-label={title} className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-white/15 bg-[#12121c] p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={`Close ${title}`} className="rounded-full px-2.5 py-1 text-white/50 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
