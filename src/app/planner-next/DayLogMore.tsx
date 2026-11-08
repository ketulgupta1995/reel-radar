"use client";

import { useEffect, useState } from "react";
import { addWater, getTodayDate, updateDayLog, WATER_GOAL, WATER_STEP, type DayLog } from "@/lib/todos";
import { useLogItems } from "@/lib/plannerSettings";
import { ClockTimePicker } from "../todos/ClockTimePicker";
import { fmtTime } from "../todos/planner";

const FIELD = "w-full rounded-lg bg-bf-s1 px-2.5 py-1.5 text-sm text-bf-ink placeholder-bf-muted focus:outline-none focus:ring-2 focus:ring-bf-ink";
const SMALL = "flex-1 rounded-lg bg-bf-s2 px-1.5 py-1 text-[11px] font-bold";
const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/\.?0+$/, "")} L`;

// The rest of the day log, opened from the tiles: wake and sleep, weight, water, the review notes,
// and when each item was ticked.
export function DayLogMore({ date, log, onChange }: { date: string; log: DayLog; onChange: (log: DayLog) => void }) {
  const items = useLogItems();
  const [weight, setWeight] = useState("");
  useEffect(() => setWeight(log.weight !== undefined ? String(log.weight) : ""), [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const water = log.water ?? 0;
  const timed = items.filter((i) => log.ticks?.[i.id]?.at !== undefined);
  // A drink logged on the day itself is marked on the schedule at its time.
  const now = () => {
    const d = new Date();
    return date === getTodayDate() ? d.getHours() * 60 + d.getMinutes() : undefined;
  };
  const note = (field: "well" | "bad" | "improve", label: string, hint: string) => (
    <textarea aria-label={label} rows={2} placeholder={hint} value={log[field] ?? ""} onChange={(e) => onChange(updateDayLog(date, { [field]: e.target.value }))} className={`${FIELD} resize-y`} />
  );

  return (
    <div className="mt-2 space-y-2.5 rounded-[14px] bg-bf-s2/60 p-2.5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ClockTimePicker tone="bf" label="Woke up" value={log.wake ?? ""} fallback="07:00" onChange={(v) => onChange(updateDayLog(date, { wake: v || undefined }))} />
        <ClockTimePicker tone="bf" label="Went to sleep" value={log.sleep ?? ""} fallback="22:30" popoverRight onChange={(v) => onChange(updateDayLog(date, { sleep: v || undefined }))} />
        <label className="flex flex-col gap-0.5 rounded-xl bg-bf-s1 px-3 py-2">
          <span className="font-bfm text-xs uppercase tracking-wide text-bf-muted">Weight</span>
          <span className="flex items-baseline gap-1.5 text-sm font-semibold tabular-nums">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              aria-label="Weight in kg"
              placeholder="0.0"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                const kg = parseFloat(e.target.value);
                onChange(updateDayLog(date, { weight: Number.isFinite(kg) ? kg : undefined }));
              }}
              className="w-full min-w-0 bg-transparent placeholder-bf-muted focus:outline-none"
            />
            <span className="font-normal text-bf-muted">kg</span>
          </span>
        </label>
        <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-bf-s1 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-2">
            <span className="font-bfm text-xs uppercase tracking-wide text-bf-muted">Water</span>
            <span className="text-sm tabular-nums">
              <b data-testid="water-total">{litres(water)}</b>
              <span className="text-bf-muted"> / {litres(WATER_GOAL)}</span>
            </span>
          </div>
          <div className="flex gap-1">
            <button aria-label="Less water" onClick={() => onChange(addWater(date, -WATER_STEP))} className={SMALL}>
              − Glass
            </button>
            <button aria-label="Add a bottle" onClick={() => onChange(addWater(date, WATER_STEP * 2, now()))} className={SMALL}>
              + Bottle
            </button>
          </div>
        </div>
      </div>
      {timed.length > 0 && <p className="font-bfm text-[11px] text-bf-muted">Ticked: {timed.map((i) => `${i.label} ${fmtTime(log.ticks![i.id].at!)}`).join(" · ")}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        {note("well", "What went well", "Wins, however small")}
        {note("bad", "What went badly", "What got in the way")}
        {note("improve", "What to improve", "One thing for tomorrow")}
      </div>
    </div>
  );
}
