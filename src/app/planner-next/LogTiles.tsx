"use client";

import { useState } from "react";
import { addWater, getTodayDate, setLogCount, setLogTick, WATER_GOAL, WATER_STEP, type DayLog } from "@/lib/todos";
import { useLogItems } from "@/lib/plannerSettings";
import { fmtTime } from "../todos/planner";

const litres = (ml: number) => `${(ml / 1000).toFixed(2).replace(/\.?0+$/, "")} L`;
const minuteNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const TILE = "flex h-[50px] w-[68px] shrink-0 flex-col items-start justify-between rounded-[10px] px-[7px] py-1.5 text-left text-[11.5px] font-extrabold leading-tight transition lg:w-auto";

// The day log as one row of small tiles: + Glass, then each log item, ticked in one tap or, for a
// number (steps), typed in place. Ticks made on the day itself keep their time.
export function LogTiles({ date, log, onChange, onMore, moreOpen }: { date: string; log: DayLog; onChange: (log: DayLog) => void; onMore: () => void; moreOpen: boolean }) {
  const items = useLogItems();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const onDay = date === getTodayDate();
  const done = items.filter((i) => (i.kind === "tick" ? log.ticks?.[i.id] : log.counts?.[i.id])).length;
  const water = log.water ?? 0;
  const save = (id: string) => {
    const n = parseInt(text.replace(/[^\d]/g, ""), 10);
    onChange(setLogCount(date, id, Number.isFinite(n) ? n : undefined));
    setEditing(null);
  };

  return (
    <section aria-label="Day log">
      <div className="flex items-baseline justify-between px-0.5 font-bfm text-[11px] uppercase tracking-[.08em] text-bf-muted">
        <span aria-label={`${done} of ${items.length} logged`}>
          Day log · {done}/{items.length}
        </span>
        <button onClick={onMore} aria-expanded={moreOpen} className="uppercase tracking-[.08em] text-bf-ink">
          {moreOpen ? "Less" : "Sleep, weight, notes"}
        </button>
      </div>
      <div role="group" aria-label="Log items" className="mt-2 flex gap-[5px] overflow-x-auto [scrollbar-width:none] lg:grid lg:grid-cols-4">
        <button
          onClick={() => onChange(addWater(date, WATER_STEP, onDay ? minuteNow() : undefined))}
          aria-label="More water"
          className={`${TILE} bg-bf-water text-bf-water-ink active:scale-95`}
        >
          <span aria-hidden className="text-[11px]">
            💧
          </span>
          <span>
            + Glass
            <small className="block font-bfm text-[9px] font-medium opacity-80">
              {litres(water)} / {litres(WATER_GOAL)}
            </small>
          </span>
        </button>
        {items.map((i) => {
          if (i.kind === "tick") {
            const tick = log.ticks?.[i.id];
            return (
              <button
                key={i.id}
                aria-pressed={!!tick}
                onClick={() => onChange(setLogTick(date, i.id, !tick, onDay ? minuteNow() : undefined))}
                className={`${TILE} active:scale-95 ${tick ? "bg-gold text-bf-ontag" : "bg-bf-s1"}`}
              >
                <span aria-hidden className="text-[11px]">
                  {tick ? "✓" : "○"}
                </span>
                <span>
                  {i.label}
                  <small className={`block font-bfm text-[9px] font-medium ${tick ? "opacity-70" : "text-bf-muted"}`}>
                    {tick ? (tick.at !== undefined ? fmtTime(tick.at) : "done") : "tap to tick"}
                  </small>
                </span>
              </button>
            );
          }
          const n = log.counts?.[i.id];
          if (editing === i.id)
            return (
              <label key={i.id} className={`${TILE} bg-gold text-bf-ontag`}>
                <span>{i.label}</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  aria-label={`${i.label}${i.unit ? `, ${i.unit}` : ""}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={() => save(i.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(i.id);
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="w-full rounded bg-white/70 px-1 font-bfm text-[11px] text-bf-ontag focus:outline-none"
                />
              </label>
            );
          return (
            <button
              key={i.id}
              onClick={() => {
                setText(n ? String(n) : "");
                setEditing(i.id);
              }}
              className={`${TILE} ${n ? "bg-gold text-bf-ontag" : "bg-bf-s1"}`}
            >
              <span aria-hidden className="text-[11px]">
                {n ? "✓" : "#"}
              </span>
              <span>
                {n ? n.toLocaleString("en-IN") : i.label}
                <small className={`block font-bfm text-[9px] font-medium ${n ? "opacity-70" : "text-bf-muted"}`}>{n ? i.label : i.unit ?? "tap to add"}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
