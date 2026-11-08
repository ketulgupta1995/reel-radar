"use client";

import { useEffect, useMemo, useState } from "react";
import { loadAllDayLogs, loadAllTodos, syncAllPlanner, getTodayDate, shiftDate, type DayLog, type Todo } from "@/lib/todos";
import { allLogItems, tagColor, tagLabel, useLogItems, useTags } from "@/lib/plannerSettings";
import { logHistory, type LogCell, type LogRow } from "@/lib/plannerLogHistory";
import { computePlannerStats, type PlannerStats } from "@/lib/plannerStats";
import { bucketDate, usageByDay, type UsageBucket } from "@/lib/usageStats";
import { DAY_LETTERS, DAY_NAMES, fmtDuration, fmtTime, formatShortDate } from "./planner";
import { Card, Legend, NO_TAG_COLOR, PLANNED, TableToggle, Tip } from "./StatsParts";
import { DayLogInsights, Headline, LineChart, TimeFitCard } from "./StatsInsights";

type Range = "7" | "30" | "90" | "all";
const RANGES: { id: Range; label: string }[] = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All time" },
];

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
const hours = (mins: number) => (mins ? fmtDuration(mins) : "0h");
const num = (n: number) => n.toLocaleString("en-US");
// "8k", "12.5k": a step count that fits a grid cell.
const short = (n: number) => (n < 1000 ? String(n) : `${Math.round(n / 100) / 10}k`);

// Everything the current stats page shows, plus the day log history grid and the steps trend on top.
export function Stats({ onOpenReview, onOpenToday }: { onOpenReview: () => void; onOpenToday: () => void }) {
  const [days, setDays] = useState<Record<string, Todo[]> | null>(null);
  const [logs, setLogs] = useState<Record<string, DayLog>>({});
  const [range, setRange] = useState<Range>("30");
  const [usage, setUsage] = useState<UsageBucket[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [today, setToday] = useState<string | null>(null);
  useTags(); // redraw when a tag's name changes

  // Show this browser's copy at once, then every month from the server (mostly unchanged, so cheap).
  useEffect(() => {
    setToday(getTodayDate());
    setDays(loadAllTodos());
    setLogs(loadAllDayLogs());
    syncAllPlanner().then((changed) => {
      if (changed) {
        setDays(loadAllTodos());
        setLogs(loadAllDayLogs());
      }
      setOffline(changed === null);
    });
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setUsage(Array.isArray(body?.buckets) ? body.buckets : []))
      .catch(() => setUsage([]));
  }, []);

  const from = useMemo(() => {
    if (!today) return null;
    if (range !== "all") return shiftDate(today, -(Number(range) - 1));
    const earliest = [...Object.keys(days ?? {}), ...Object.keys(logs)].filter((d) => d <= today).sort()[0];
    return earliest ?? today;
  }, [range, days, logs, today]);
  const stats = useMemo(() => (days && from && today ? computePlannerStats(days, from, today) : null), [days, from, today]);
  if (!today || !from || !days) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="font-bfm text-[11px] text-bf-muted">
          {formatShortDate(from)} – {formatShortDate(today)} · {offline ? "this browser's copy (couldn't reach the server)" : "across all your devices"}
        </p>
        <div role="group" aria-label="Period" className="flex rounded-[12px] bg-bf-s1 p-1 text-xs font-extrabold">
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} aria-pressed={range === r.id} className={`rounded-[9px] px-2.5 py-1.5 ${range === r.id ? "bg-bf-ink text-bf-bg" : "text-bf-muted"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <LogHistory logs={logs} from={from} today={today} />
      <CountTrends logs={logs} from={from} today={today} />
      <DayLogInsights days={days} logs={logs} from={from} today={today} compare={range !== "all"} />

      {!stats ? null : stats.total === 0 ? (
        <div className="rounded-[16px] border-2 border-dashed border-bf-line p-10 text-center text-sm text-bf-muted">
          No tasks in this period yet.{" "}
          <button onClick={onOpenToday} className="font-bold text-bf-ink underline">
            Plan your day
          </button>
        </div>
      ) : (
        <TaskStats stats={stats} onOpenReview={onOpenReview} />
      )}

      <TimeFitCard days={days} from={from} today={today} />
      {usage && <UsageChart buckets={usage} range={range} today={today} />}
    </div>
  );
}

const cellLabel = (row: LogRow, c: LogCell) =>
  `${row.item.label}, ${formatShortDate(c.date)}: ${
    row.item.kind === "number" ? (c.count ? `${num(c.count)} ${row.item.unit ?? ""}`.trim() : "nothing logged") : c.done ? (c.at !== undefined ? `done at ${fmtTime(c.at)}` : "done") : "not done"
  }`;

// One row per day log item, one cell per day. Removed items keep their history under "All".
function LogHistory({ logs, from, today }: { logs: Record<string, DayLog>; from: string; today: string }) {
  const active = useLogItems();
  const [all, setAll] = useState(false);
  // Removed items only appear in the full list, which isn't kept live; it's read when shown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (all ? allLogItems() : active), [all, active]);
  const rows = useMemo(() => logHistory(logs, items, from, today), [logs, items, from, today]);
  const hasRemoved = all || allLogItems().some((i) => i.removed);
  const week = rows[0]?.cells.length <= 7;
  const cell = week ? "h-9 w-9 text-sm" : "h-6 w-6 text-[9px]";

  return (
    <Card title="Day log history" sub="Each day's ticks and counts. The streak counts days in a row, up to today.">
      {hasRemoved && (
        <div role="group" aria-label="Which items" className="-mt-1 mb-3 flex gap-1 text-xs font-extrabold">
          {(["Shown", "All"] as const).map((label) => (
            <button key={label} onClick={() => setAll(label === "All")} aria-pressed={all === (label === "All")} className={`rounded-lg px-2.5 py-1 ${all === (label === "All") ? "bg-bf-ink text-bf-bg" : "bg-bf-s2 text-bf-muted"}`}>
              {label === "All" ? "All, with removed" : label}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[3px]">
          {week && (
            <thead>
              <tr>
                <th className="sticky left-0 bg-bf-s1" />
                {rows[0].cells.map((c) => (
                  <th key={c.date} className="font-bfm text-[10px] font-bold text-bf-muted">
                    {DAY_LETTERS[new Date(c.date + "T00:00:00").getDay()]}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row) => (
              <tr key={row.item.id}>
                <th scope="row" className="sticky left-0 z-[1] bg-bf-s1 pr-2 text-left align-middle">
                  <div className={`whitespace-nowrap text-[13px] font-extrabold ${row.item.removed ? "text-bf-muted line-through" : ""}`}>{row.item.label}</div>
                  <div className="whitespace-nowrap font-bfm text-[10.5px] font-normal text-bf-muted">
                    {row.item.kind === "number" ? (row.average === null ? "–" : `${num(row.average)} avg`) : row.rate === null ? "–" : `${row.rate}%`}
                    {row.streak > 0 && ` · 🔥 ${row.streak}`}
                  </div>
                </th>
                {row.cells.map((c) => (
                  <td key={c.date} aria-label={cellLabel(row, c)} title={cellLabel(row, c)} className={`${cell} rounded-[5px] p-0 text-center font-bfm font-bold ${c.done ? "bg-bf-ink text-bf-bg" : "bg-bf-s2"}`}>
                    {c.count ? short(c.count) : c.done ? "✓" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// A line per number item (Walk's steps by default), over the period chosen.
function CountTrends({ logs, from, today }: { logs: Record<string, DayLog>; from: string; today: string }) {
  const items = useLogItems().filter((i) => i.kind === "number");
  const rows = logHistory(logs, items, from, today).filter((r) => r.average !== null);
  if (!rows.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((r) => {
        const unit = r.item.unit ?? "";
        const format = (v: number) => `${num(v)} ${unit}`.trim();
        const points = r.cells.map((c) => ({ start: c.date, end: c.date, value: c.count ?? null }));
        return (
          <Card key={r.item.id} title={`${r.item.label} trend`} sub={`${unit ? unit[0].toUpperCase() + unit.slice(1) : "Count"} per day, on the days you logged them`}>
            <Headline value={`${format(r.average!)} avg`} note={`${r.cells.filter((c) => c.count).length} days logged`} />
            <LineChart points={points} format={format} />
            <TableToggle head={["Date", r.item.label]} rows={r.cells.filter((c) => c.count).map((c) => [formatShortDate(c.date), format(c.count!)])} />
          </Card>
        );
      })}
    </div>
  );
}

function TaskStats({ stats, onOpenReview }: { stats: PlannerStats; onOpenReview: () => void }) {
  const tiles = [
    { label: "Completion", value: `${pct(stats.done, stats.total)}%`, sub: `${stats.done} of ${stats.total} tasks done` },
    { label: "Planned", value: hours(stats.plannedMinutes), sub: "in time blocks" },
    { label: "Done", value: hours(stats.doneMinutes), sub: `${pct(stats.doneMinutes, stats.plannedMinutes)}% of planned time` },
    { label: "Focused", value: hours(stats.focusedMinutes), sub: "with the focus timer" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[14px] bg-bf-s1 px-3.5 py-3">
            <div className="truncate font-bfm text-[10.5px] font-bold uppercase tracking-[.08em] text-bf-muted">{t.label}</div>
            <div className="mt-0.5 text-[26px] font-black [font-stretch:115%]">{t.value}</div>
            <div className="truncate font-bfm text-[11px] text-bf-muted">{t.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <WeekdayChart stats={stats} />
        <TagChart stats={stats} />
      </div>
      <HoursChart stats={stats} />
      <CarriedList stats={stats} onOpenReview={onOpenReview} />
    </div>
  );
}

function WeekdayChart({ stats }: { stats: PlannerStats }) {
  return (
    <Card title="Completion by weekday" sub="Share of each weekday's tasks that got done">
      <div className="flex h-44 items-end gap-0.5">
        {stats.byWeekday.map((w) => {
          const rate = pct(w.done, w.total);
          return (
            <div key={w.day} tabIndex={0} className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none" aria-label={`${DAY_NAMES[w.day]}: ${w.total ? `${rate}%, ${w.done} of ${w.total} done` : "no tasks"}`}>
              <Tip>
                <span className="block font-bold">{w.total ? `${rate}%` : "No tasks"}</span>
                {DAY_NAMES[w.day]}
                {w.total ? ` · ${w.done} of ${w.total} done` : ""}
              </Tip>
              <span className="mb-1 font-bfm text-[11px] tabular-nums text-bf-muted">{w.total ? `${rate}%` : "–"}</span>
              <div className="flex h-28 w-full max-w-[2.5rem] items-end rounded-t bg-bf-s2">{w.total > 0 && <div className="w-full rounded-t bg-bf-ink" style={{ height: `${Math.max(rate, 1)}%` }} />}</div>
              <span className="mt-1.5 font-bfm text-[11px] text-bf-muted">{DAY_NAMES[w.day]}</span>
            </div>
          );
        })}
      </div>
      <TableToggle head={["Day", "Done", "Tasks", "Rate"]} rows={stats.byWeekday.map((w) => [DAY_NAMES[w.day], w.done, w.total, w.total ? `${pct(w.done, w.total)}%` : "–"])} />
    </Card>
  );
}

function TagChart({ stats }: { stats: PlannerStats }) {
  const max = Math.max(...stats.byTag.map((t) => t.total), 1);
  return (
    <Card title="Tasks by tag" sub="Bar length is tasks; the filled part is how many got done">
      <ul className="flex flex-col gap-2.5">
        {stats.byTag.map((t) => {
          const color = t.tag ? tagColor(t.tag) : NO_TAG_COLOR;
          const label = t.tag ? tagLabel(t.tag) : "No tag";
          return (
            <li key={t.tag ?? "none"} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 truncate font-bold">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                {label}
              </span>
              <div tabIndex={0} className="group relative h-3 outline-none" aria-label={`${label}: ${t.done} of ${t.total} done`}>
                <Tip>
                  <span className="block font-bold">
                    {t.done} of {t.total} done
                  </span>
                  {label} · {pct(t.done, t.total)}%
                </Tip>
                <div className="absolute inset-y-0 left-0 rounded-r border-2" style={{ width: `${(t.total / max) * 100}%`, borderColor: color }} />
                <div className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${(t.done / max) * 100}%`, background: color }} />
              </div>
              <span className="text-right font-bfm tabular-nums text-bf-muted">
                {t.done}/{t.total}
              </span>
            </li>
          );
        })}
      </ul>
      <TableToggle head={["Tag", "Done", "Tasks", "Rate"]} rows={stats.byTag.map((t) => [t.tag ? tagLabel(t.tag) : "No tag", t.done, t.total, `${pct(t.done, t.total)}%`])} />
    </Card>
  );
}

function HoursChart({ stats }: { stats: PlannerStats }) {
  const max = Math.max(...stats.buckets.map((b) => b.plannedMinutes), 60);
  const weekly = stats.buckets.length > 0 && stats.buckets[0].start !== stats.buckets[0].end;
  const labelEvery = Math.ceil(stats.buckets.length / 10);
  const label = (b: (typeof stats.buckets)[number]) => (b.start === b.end ? formatShortDate(b.start) : `${formatShortDate(b.start)} – ${formatShortDate(b.end)}`);
  return (
    <Card title="Planned vs. done hours" sub={`Time blocks per ${weekly ? "week" : "day"}`}>
      <Legend items={[[PLANNED, "Planned"], ["bg-bf-ink", "Done"]]} />
      <div className="flex h-44 items-end gap-0.5">
        {stats.buckets.map((b, i) => (
          <div key={b.start} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none" aria-label={`${label(b)}: ${hours(b.doneMinutes)} done of ${hours(b.plannedMinutes)} planned`}>
            <Tip>
              <span className="block opacity-70">{label(b)}</span>
              <span className="font-bold">{hours(b.plannedMinutes)}</span> planned
              <br />
              <span className="font-bold">{hours(b.doneMinutes)}</span> done
            </Tip>
            <div className="relative flex h-36 w-full max-w-[2.5rem] items-end">
              {b.plannedMinutes > 0 && <div className={`absolute inset-x-0 bottom-0 rounded-t border-b-0 ${PLANNED}`} style={{ height: `${(b.plannedMinutes / max) * 100}%` }} />}
              {b.doneMinutes > 0 && <div className="absolute inset-x-[3px] bottom-0 rounded-t bg-bf-ink" style={{ height: `${(b.doneMinutes / max) * 100}%` }} />}
            </div>
            <span className="mt-1.5 h-3 whitespace-nowrap font-bfm text-[10px] text-bf-muted">{i % labelEvery === 0 ? formatShortDate(b.start) : ""}</span>
          </div>
        ))}
      </div>
      <TableToggle head={[weekly ? "Week" : "Day", "Planned", "Done"]} rows={stats.buckets.map((b) => [label(b), hours(b.plannedMinutes), hours(b.doneMinutes)])} />
    </Card>
  );
}

// Database reads and writes per day for the whole app (planner, library and history), from /api/usage.
function UsageChart({ buckets, range, today }: { buckets: UsageBucket[]; range: Range; today: string }) {
  const days = useMemo(() => {
    const dates = buckets.map((b) => bucketDate(b.t)).sort();
    const from = range === "all" ? (dates[0] ?? today) : shiftDate(today, -(Number(range) - 1));
    return usageByDay(buckets, from, today);
  }, [buckets, range, today]);
  const reads = days.reduce((n, d) => n + d.reads, 0);
  const writes = days.reduce((n, d) => n + d.writes, 0);
  const max = Math.max(...days.map((d) => Math.max(d.reads, d.writes)), 1);
  const labelEvery = Math.ceil(days.length / 10);
  return (
    <Card title="Database reads and writes" sub="Every database query the app made, per day. It counts from when this was added, and the last few queries may be missing.">
      <Legend items={[["bg-bf-ink", `Reads · ${num(reads)}`], ["bg-bf-water-ink", `Writes · ${num(writes)}`]]} />
      <div className="flex h-44 items-end gap-0.5">
        {days.map((d, i) => (
          <div key={d.date} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none" aria-label={`${formatShortDate(d.date)}: ${num(d.reads)} reads, ${num(d.writes)} writes`}>
            <Tip>
              <span className="block opacity-70">{formatShortDate(d.date)}</span>
              <span className="font-bold">{num(d.reads)}</span> reads
              <br />
              <span className="font-bold">{num(d.writes)}</span> writes
            </Tip>
            <div className="flex h-36 w-full max-w-[2.5rem] items-end justify-center gap-px">
              <div className="w-1/2 rounded-t bg-bf-ink" style={{ height: `${(d.reads / max) * 100}%` }} />
              <div className="w-1/2 rounded-t bg-bf-water-ink" style={{ height: `${(d.writes / max) * 100}%` }} />
            </div>
            <span className="mt-1.5 h-3 whitespace-nowrap font-bfm text-[10px] text-bf-muted">{i % labelEvery === 0 ? formatShortDate(d.date) : ""}</span>
          </div>
        ))}
      </div>
      <TableToggle head={["Day", "Reads", "Writes"]} rows={[...days].reverse().map((d) => [formatShortDate(d.date), num(d.reads), num(d.writes)])} />
    </Card>
  );
}

function CarriedList({ stats, onOpenReview }: { stats: PlannerStats; onOpenReview: () => void }) {
  return (
    <Card title="Most postponed" sub="Tasks brought over from an earlier day, by how many days they were pushed">
      <button onClick={onOpenReview} className="-mt-1 mb-3 text-xs font-bold underline">
        Reschedule or drop them in the weekly review →
      </button>
      {stats.carried.length === 0 ? (
        <p className="text-sm text-bf-muted">Nothing was carried over in this period.</p>
      ) : (
        <ul className="divide-y divide-bf-line">
          {stats.carried.map((c) => (
            <li key={c.id + c.to} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words font-semibold">{c.text}</span>
              <span className="font-bfm text-[11px] text-bf-muted">
                {formatShortDate(c.from)} → {formatShortDate(c.to)}
              </span>
              <span className="rounded-full bg-bf-s2 px-2 py-0.5 font-bfm text-[11px] tabular-nums">
                {c.days} {c.days === 1 ? "day" : "days"}
              </span>
              {c.times > 1 && <span className="rounded-full bg-bf-s2 px-2 py-0.5 font-bfm text-[11px] tabular-nums">{c.times} times</span>}
              <span className={`font-bfm text-[11px] font-bold ${c.completed ? "" : "text-bf-muted"}`}>{c.completed ? "✓ Done" : "Open"}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
