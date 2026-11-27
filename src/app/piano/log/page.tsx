"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { deleteSession, loadSettings, newSessionId, openKeys, recentRecords, saveManual, syncPianoHistory, usePianoSync } from "@/lib/pianoData";
import { ManualRecord, SessionRecord } from "@/lib/pianoDrill";
import { drillsIn, lastDays, minutesOf, streak, todayMs, weeklyTrend } from "@/lib/pianoLog";

const DRILL_TITLES: Record<string, string> = { notes: "Note drill", chords: "Chord drill", fingers: "Five-finger positions" };
const HISTORY = 400; // days of records read: enough for the streak (counts up to about a year back) and the trends
const dayName = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const secs = (x: number | null) => (x === null ? "–" : `${(x / 1000).toFixed(1)} s`);

export default function PianoLog() {
  // Today and the saved records are read after the first render (server and first client render match).
  const [now, setNow] = useState<number | null>(null);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [dayIdx, setDayIdx] = useState(0); // days back from today
  const [editing, setEditing] = useState<ManualRecord | null>(null);

  const reload = () => {
    const t = Date.now();
    setNow(t);
    setRecords(recentRecords(t, HISTORY));
  };
  useEffect(reload, []);
  // The charts reach back a year, so pull every month the settings list, once; then show what arrived.
  useEffect(() => void syncPianoHistory(), []);
  usePianoSync(reload, () => [...new Set([...openKeys(), ...loadSettings().months.map((m) => `piano-${m}`)])]);

  if (now === null) return <Shell>{null}</Shell>;

  const days = lastDays(records, now, 14);
  const trends = drillsIn(records).map((d) => ({ drill: d, weeks: weeklyTrend(records, d, now) }));
  const entries = [...records].sort((a, b) => b.startedAt - a.startedAt).filter((r) => r.startedAt >= days[days.length - 1].date.getTime());
  const mins = Number(minutes);
  const valid = Number.isFinite(mins) && mins >= 1 && mins <= 600;

  const reset = () => {
    setEditing(null);
    setMinutes("");
    setNote("");
    setDayIdx(0);
  };
  const save = () => {
    if (!valid) return;
    const t = Date.now();
    // Keep the time of day when editing; a new entry on another day is stamped at noon so it can't slip across midnight.
    const base = days[dayIdx].date;
    const at = editing && dayIdx === daysBack(editing.startedAt, now)
      ? editing.startedAt
      : dayIdx === 0
        ? t
        : new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12).getTime();
    saveManual({ id: editing?.id ?? newSessionId(), kind: "manual", startedAt: at, durationMs: Math.round(mins) * 60_000, note: note.trim(), updatedAt: t }, editing ?? undefined);
    reset();
    reload();
  };
  const edit = (r: ManualRecord) => {
    setEditing(r);
    setMinutes(String(minutesOf(r.durationMs)));
    setNote(r.note);
    setDayIdx(Math.max(0, daysBack(r.startedAt, now)));
  };

  return (
    <Shell>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
          <div className="text-sm text-white/60">Today</div>
          <div className="text-3xl font-bold" data-testid="today-minutes">{minutesOf(todayMs(records, now))} min</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
          <div className="text-sm text-white/60">Streak</div>
          <div className="text-3xl font-bold" data-testid="streak">{streak(records, now)} {streak(records, now) === 1 ? "day" : "days"}</div>
        </div>
      </div>

      <section className="space-y-2 rounded-2xl border border-white/10 bg-panel/60 p-4">
        <h2 className="font-semibold">{editing ? "Edit entry" : "Add practice done away from the app"}</h2>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Minutes" type="number" inputMode="numeric" min={1} max={600} placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-24 rounded-lg bg-white/10 px-3 py-2" />
          <select aria-label="Day" value={dayIdx} onChange={(e) => setDayIdx(Number(e.target.value))} className="rounded-lg bg-white/10 px-3 py-2">
            {days.map((d, i) => (
              <option key={d.key} value={i} className="text-black">{i === 0 ? "Today" : i === 1 ? "Yesterday" : dayName(d.date)}</option>
            ))}
          </select>
          <input aria-label="Note" placeholder="Note, e.g. Minuet in G from my book" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2" />
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={!valid} className="rounded-lg bg-white/20 px-4 py-2 font-semibold disabled:opacity-40">{editing ? "Save changes" : "Add"}</button>
          {editing && <button onClick={reset} className="rounded-lg bg-white/10 px-4 py-2">Cancel</button>}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Last 2 weeks</h2>
        <ul className="space-y-1">
          {days.map((d) => (
            <li key={d.key} data-testid="day-row" className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 text-white/70">{dayName(d.date)}</span>
              <span className="h-2 flex-1 rounded bg-white/10"><span className={`block h-2 rounded ${d.counts ? "bg-green-400" : "bg-white/40"}`} style={{ width: `${Math.min(100, (d.ms / 60_000 / 30) * 100)}%` }} /></span>
              <span className="w-20 shrink-0 text-right">{minutesOf(d.ms)} min{d.counts ? " ✓" : ""}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-white/50">✓ = 10 minutes or more, so the day counts toward the streak.</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Weekly trend by drill</h2>
        {trends.length === 0 && <p className="text-sm text-white/60">Finish a drill round to see accuracy and speed here.</p>}
        {trends.map(({ drill, weeks }) => (
          <div key={drill} className="overflow-x-auto">
            <table className="w-full text-sm" aria-label={`${DRILL_TITLES[drill] ?? drill} trend`}>
              <caption className="pb-1 text-left font-medium">{DRILL_TITLES[drill] ?? drill}</caption>
              <thead className="text-white/60">
                <tr><th className="text-left font-normal">Week ending</th><th className="text-right font-normal">Answers</th><th className="text-right font-normal">Accuracy</th><th className="text-right font-normal">Avg reaction</th></tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.end.getTime()}>
                    <td>{w.end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                    <td className="text-right">{w.attempts}</td>
                    <td className="text-right">{pct(w.accuracy)}</td>
                    <td className="text-right">{secs(w.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Recent entries</h2>
        {entries.length === 0 && <p className="text-sm text-white/60">Nothing logged yet.</p>}
        <ul className="space-y-2">
          {entries.map((r) => (
            <li key={r.id} data-testid="entry" className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-panel/60 px-3 py-2 text-sm">
              <span className="w-28 shrink-0 text-white/70">{dayName(new Date(r.startedAt))}</span>
              <span className="min-w-0 flex-1">{r.kind === "manual" ? r.note || "Practice" : DRILL_TITLES[r.drill] ?? r.drill}</span>
              <span>{minutesOf(r.durationMs)} min</span>
              {r.kind === "manual" && (
                <>
                  <button onClick={() => edit(r)} aria-label={`Edit ${r.note || "entry"}`} className="rounded bg-white/10 px-2 py-1">Edit</button>
                  <button onClick={() => { deleteSession(r); if (editing?.id === r.id) reset(); reload(); }} aria-label={`Delete ${r.note || "entry"}`} className="rounded bg-white/10 px-2 py-1">Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

const daysBack = (ts: number, now: number) => {
  const a = new Date(ts);
  const b = new Date(now);
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000);
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10 sm:px-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Practice log</h1>
        <Link href="/piano" className="text-sm text-white/60 hover:text-white">Piano</Link>
      </div>
      {children}
    </div>
  );
}
