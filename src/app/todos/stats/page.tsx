"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadAllTodos, getTodayDate, shiftDate, TAGS, type TagId, type Todo } from "@/lib/todos";
import { computePlannerStats, type PlannerStats } from "@/lib/plannerStats";
import { DAY_NAMES, TAG_COLORS, fmtDuration, formatShortDate } from "../planner";

type Range = "7" | "30" | "90" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All time" },
];
const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.id, t.label])) as Record<TagId, string>;
const NO_TAG_COLOR = "rgba(255,255,255,0.35)";

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
const hours = (mins: number) => (mins ? fmtDuration(mins) : "0h");

export default function PlannerStatsPage() {
  const [days, setDays] = useState<Record<string, Todo[]> | null>(null);
  const [range, setRange] = useState<Range>("30");

  useEffect(() => setDays(loadAllTodos()), []);

  const today = getTodayDate();
  const from = useMemo(() => {
    if (range !== "all") return shiftDate(today, -(Number(range) - 1));
    const earliest = Object.keys(days ?? {}).filter((d) => d <= today).sort()[0];
    return earliest ?? today;
  }, [range, days, today]);
  const stats = useMemo(() => (days ? computePlannerStats(days, from, today) : null), [days, from, today]);

  return (
    <main className="min-h-screen bg-[#090910] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="shrink-0 font-bold tracking-[.2em] text-gold">
            REEL RADAR
          </Link>
          <Link href="/todos" className="text-sm text-white/70 transition hover:text-gold">
            ← Daily Planner
          </Link>
        </nav>
      </header>

      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-5 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Planner stats</h1>
            <p className="mt-1 text-white/60">
              {formatShortDate(from)} – {formatShortDate(today)} · from the days saved in this browser
            </p>
          </div>
          <div className="flex self-start rounded-full border border-white/15 bg-white/5 p-0.5 text-sm sm:self-auto">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                aria-pressed={range === r.id}
                className={`rounded-full px-3 py-1 transition ${
                  range === r.id ? "bg-gold font-semibold text-black" : "text-white/70 hover:text-white"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {!stats ? null : stats.total === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-panel/60 p-12 text-center text-white/60">
            No tasks in this period yet.{" "}
            <Link href="/todos" className="text-gold hover:underline">
              Plan your day
            </Link>
          </div>
        ) : (
          <Stats stats={stats} />
        )}
      </div>
    </main>
  );
}

function Stats({ stats }: { stats: PlannerStats }) {
  const tiles = [
    { label: "Completion", value: `${pct(stats.done, stats.total)}%`, sub: `${stats.done} of ${stats.total} tasks done` },
    { label: "Planned", value: hours(stats.plannedMinutes), sub: "in time blocks" },
    {
      label: "Done",
      value: hours(stats.doneMinutes),
      sub: `${pct(stats.doneMinutes, stats.plannedMinutes)}% of planned time`,
    },
    { label: "Focused", value: hours(stats.focusedMinutes), sub: "with the focus timer" },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="truncate text-[11px] uppercase tracking-wider text-white/45 sm:text-xs">{t.label}</div>
            <div className="mt-1 text-xl font-semibold sm:text-2xl">{t.value}</div>
            <div className="truncate text-[11px] text-white/45 sm:text-xs">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <WeekdayChart stats={stats} />
        <TagChart stats={stats} />
      </div>
      <HoursChart stats={stats} />
      <CarriedList stats={stats} />
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-panel/60 p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-white/50">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

// Hover/focus tooltip for a chart mark; the mark's whole column is the hit target.
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-[12rem] -translate-x-1/2 rounded-lg border border-white/15 bg-ink px-2.5 py-1.5 text-left text-xs text-white/70 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus:opacity-100">
      {children}
    </span>
  );
}

function TableToggle({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-4 text-xs text-white/60">
      <summary className="cursor-pointer select-none text-white/45 hover:text-white">View as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-white/45">
            <tr>
              {head.map((h) => (
                <th key={h} className="py-1 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                {r.map((c, j) => (
                  <td key={j} className="py-1 pr-4">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function WeekdayChart({ stats }: { stats: PlannerStats }) {
  return (
    <Card title="Completion by weekday" sub="Share of each weekday's tasks that got done">
      <div className="flex h-44 items-end gap-0.5">
        {stats.byWeekday.map((w) => {
          const rate = pct(w.done, w.total);
          return (
            <div
              key={w.day}
              tabIndex={0}
              className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none"
              aria-label={`${DAY_NAMES[w.day]}: ${w.total ? `${rate}%, ${w.done} of ${w.total} done` : "no tasks"}`}
            >
              <Tip>
                <span className="block font-semibold text-white">{w.total ? `${rate}%` : "No tasks"}</span>
                {DAY_NAMES[w.day]}
                {w.total ? ` · ${w.done} of ${w.total} done` : ""}
              </Tip>
              <span className="mb-1 text-[11px] tabular-nums text-white/70">{w.total ? `${rate}%` : "–"}</span>
              <div className="flex h-28 w-full max-w-[2.5rem] items-end rounded-t bg-white/[.04] group-hover:bg-white/[.07] group-focus:bg-white/[.07]">
                {w.total > 0 && <div className="w-full rounded-t bg-gold" style={{ height: `${Math.max(rate, 1)}%` }} />}
              </div>
              <span className="mt-1.5 text-[11px] text-white/55">{DAY_NAMES[w.day]}</span>
            </div>
          );
        })}
      </div>
      <TableToggle
        head={["Day", "Done", "Tasks", "Rate"]}
        rows={stats.byWeekday.map((w) => [DAY_NAMES[w.day], w.done, w.total, w.total ? `${pct(w.done, w.total)}%` : "–"])}
      />
    </Card>
  );
}

function TagChart({ stats }: { stats: PlannerStats }) {
  const max = Math.max(...stats.byTag.map((t) => t.total), 1);
  return (
    <Card title="Tasks by tag" sub="Bar length is tasks; the filled part is how many got done">
      <ul className="space-y-2.5">
        {stats.byTag.map((t) => {
          const color = t.tag ? TAG_COLORS[t.tag] : NO_TAG_COLOR;
          const label = t.tag ? TAG_LABEL[t.tag] : "No tag";
          return (
            <li key={t.tag ?? "none"} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 truncate text-white/75">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                {label}
              </span>
              <div
                tabIndex={0}
                className="group relative h-3 outline-none"
                aria-label={`${label}: ${t.done} of ${t.total} done`}
              >
                <Tip>
                  <span className="block font-semibold text-white">
                    {t.done} of {t.total} done
                  </span>
                  {label} · {pct(t.done, t.total)}%
                </Tip>
                <div
                  className="absolute inset-y-0 left-0 rounded-r border"
                  style={{ width: `${(t.total / max) * 100}%`, borderColor: color }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-r"
                  style={{ width: `${(t.done / max) * 100}%`, background: color }}
                />
              </div>
              <span className="text-right tabular-nums text-white/60">
                {t.done}/{t.total}
              </span>
            </li>
          );
        })}
      </ul>
      <TableToggle
        head={["Tag", "Done", "Tasks", "Rate"]}
        rows={stats.byTag.map((t) => [t.tag ? TAG_LABEL[t.tag] : "No tag", t.done, t.total, `${pct(t.done, t.total)}%`])}
      />
    </Card>
  );
}

function HoursChart({ stats }: { stats: PlannerStats }) {
  const max = Math.max(...stats.buckets.map((b) => b.plannedMinutes), 60);
  const weekly = stats.buckets.length > 0 && stats.buckets[0].start !== stats.buckets[0].end;
  const labelEvery = Math.ceil(stats.buckets.length / 10);
  const label = (b: (typeof stats.buckets)[number]) =>
    b.start === b.end ? formatShortDate(b.start) : `${formatShortDate(b.start)} – ${formatShortDate(b.end)}`;
  return (
    <Card title="Planned vs. done hours" sub={`Time blocks per ${weekly ? "week" : "day"}`}>
      <div className="mb-3 flex gap-4 text-xs text-white/60">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-white/40 bg-white/10" /> Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-gold" /> Done
        </span>
      </div>
      <div className="flex h-44 items-end gap-0.5">
        {stats.buckets.map((b, i) => (
          <div
            key={b.start}
            tabIndex={0}
            className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
            aria-label={`${label(b)}: ${hours(b.doneMinutes)} done of ${hours(b.plannedMinutes)} planned`}
          >
            <Tip>
              <span className="block text-white/50">{label(b)}</span>
              <span className="font-semibold text-white">{hours(b.plannedMinutes)}</span> planned
              <br />
              <span className="font-semibold text-white">{hours(b.doneMinutes)}</span> done
            </Tip>
            <div className="relative flex h-36 w-full max-w-[2.5rem] items-end group-hover:bg-white/[.03] group-focus:bg-white/[.03]">
              {b.plannedMinutes > 0 && (
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t border border-b-0 border-white/40 bg-white/10"
                  style={{ height: `${(b.plannedMinutes / max) * 100}%` }}
                />
              )}
              {b.doneMinutes > 0 && (
                <div
                  className="absolute inset-x-[3px] bottom-0 rounded-t bg-gold"
                  style={{ height: `${(b.doneMinutes / max) * 100}%` }}
                />
              )}
            </div>
            <span className="mt-1.5 h-3 whitespace-nowrap text-[10px] text-white/45">
              {i % labelEvery === 0 ? formatShortDate(b.start) : ""}
            </span>
          </div>
        ))}
      </div>
      <TableToggle
        head={[weekly ? "Week" : "Day", "Planned", "Done"]}
        rows={stats.buckets.map((b) => [label(b), hours(b.plannedMinutes), hours(b.doneMinutes)])}
      />
    </Card>
  );
}

function CarriedList({ stats }: { stats: PlannerStats }) {
  return (
    <Card title="Most postponed" sub="Tasks brought over from an earlier day, by how many days they were pushed">
      {stats.carried.length === 0 ? (
        <p className="text-sm text-white/50">Nothing was carried over in this period.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {stats.carried.map((c) => (
            <li key={c.id + c.to} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words text-white/85">{c.text}</span>
              <span className="text-xs text-white/50">
                {formatShortDate(c.from)} → {formatShortDate(c.to)}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/75">
                {c.days} {c.days === 1 ? "day" : "days"}
              </span>
              <span className={`text-xs ${c.completed ? "text-gold" : "text-white/45"}`}>
                {c.completed ? "✓ Done" : "Open"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
