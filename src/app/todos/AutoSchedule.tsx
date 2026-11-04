"use client";

import type { DayPlan, DayWindow, PlannedBlock } from "@/lib/autoSchedule";
import { DURATIONS, clampStart, fmtDuration, fmtTime, fromInputTime, toInputTime } from "./planner";

// A proposed plan for the day. Nothing is saved until it's applied, so every block can be changed or
// left out first. A block moved onto another shows side by side, like any other overlap.
export function AutoSchedulePanel({
  plan,
  window,
  repeating,
  onChange,
  onApply,
  onCancel,
}: {
  plan: DayPlan;
  window: DayWindow;
  repeating: number;
  onChange: (blocks: PlannedBlock[]) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const update = (id: string, change: Partial<PlannedBlock>) => onChange(plan.placed.map((b) => (b.id === id ? { ...b, ...change } : b)));
  return (
    <div className="border-b border-white/10 bg-white/[.03] px-4 py-3 text-sm" aria-label="Proposed schedule" role="region">
      <p className="text-xs text-white/60">
        {plan.placed.length ? "Proposed" : "No free time"} between {fmtTime(window.from)} and {fmtTime(window.to)}
        {window.usual ? " (your usual times)" : ""}, most important first. Change anything, then apply.
      </p>
      {plan.placed.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {[...plan.placed].sort((a, b) => a.start - b.start).map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 basis-32 break-words text-white/85">{b.text}</span>
              <input
                type="time"
                step={900}
                value={toInputTime(b.start)}
                onChange={(e) => {
                  const v = fromInputTime(e.target.value);
                  if (v !== null) update(b.id, { start: clampStart(v, b.duration) });
                }}
                aria-label={`Start time for “${b.text}”`}
                className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-xs text-white [color-scheme:dark]"
              />
              <select
                value={b.duration}
                onChange={(e) => {
                  const duration = Number(e.target.value);
                  update(b.id, { duration, start: clampStart(b.start, duration) });
                }}
                aria-label={`Length of “${b.text}”`}
                className="rounded-lg border border-white/10 bg-panel px-2 py-1 text-xs text-white"
              >
                {Array.from(new Set([...DURATIONS, b.duration]))
                  .sort((x, y) => x - y)
                  .map((d) => (
                    <option key={d} value={d}>
                      {fmtDuration(d)}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => onChange(plan.placed.filter((x) => x.id !== b.id))}
                aria-label={`Leave “${b.text}” out`}
                className="text-xs text-white/45 hover:text-white"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {plan.unplaced.length > 0 && (
        <p className="mt-2 text-xs text-white/55">
          Didn&apos;t fit: {plan.unplaced.map((t) => t.text).join(", ")}
        </p>
      )}
      {repeating > 0 && (
        <p className="mt-2 text-xs text-white/45">
          Left out {repeating} repeating {repeating === 1 ? "task" : "tasks"}: giving one a time sets it for every later day too.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button onClick={onApply} disabled={!plan.placed.length} className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          Apply
        </button>
        <button onClick={onCancel} className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold">
          Cancel
        </button>
      </div>
    </div>
  );
}
