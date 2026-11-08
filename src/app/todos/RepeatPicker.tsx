"use client";

import type { RepeatRule } from "@/lib/reminders";
import { DAY_LETTERS, DAY_NAMES } from "./planner";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

export function repeatLabel(rule: RepeatRule = {}): string {
  if (rule.monthDay) return `Monthly on the ${ordinal(rule.monthDay)}`;
  if (rule.every) return rule.every % 7 === 0 ? `Every ${rule.every / 7 === 1 ? "week" : `${rule.every / 7} weeks`}` : `Every ${rule.every} days`;
  if (rule.timesPerWeek) return `${rule.timesPerWeek}× a week`;
  if (!rule.days) return "Daily";
  if (rule.days.join() === "1,2,3,4,5") return "Weekdays";
  if (rule.days.join() === "0,6") return "Weekends";
  return rule.days.map((d) => DAY_NAMES[d]).join(", ");
}

type Mode = "days" | "every" | "monthDay" | "timesPerWeek";
const modeOf = (rule: RepeatRule): Mode => (rule.monthDay ? "monthDay" : rule.every ? "every" : rule.timesPerWeek ? "timesPerWeek" : "days");

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const EVERY_OPTIONS = [...range(2, 14), 21, 28, 30, 60, 90];
const FIELD = "rounded-lg border border-white/10 bg-panel px-2 py-1 text-white focus:border-gold/50 focus:outline-none";
const BF_FIELD = "rounded-lg bg-bf-s2 px-2 py-1 font-bold text-bf-ink focus:outline-none focus:ring-2 focus:ring-bf-ink"; // the new planner's palette

// Choose how a task repeats. Lists rather than number boxes: each change is saved at once, and typing
// "12" would pass through "1" on the way.
export function RepeatPicker({ value, onChange, date, tone = "dark" }: { value: RepeatRule; onChange: (rule: RepeatRule) => void; date: string; tone?: "dark" | "bf" }) {
  const mode = modeOf(value);
  const bf = tone === "bf";
  const field = bf ? BF_FIELD : FIELD;
  const switchTo = (next: Mode) => {
    if (next === "days") onChange({});
    else if (next === "every") onChange({ every: 2 });
    else if (next === "monthDay") onChange({ monthDay: Number(date.slice(8)) });
    else onChange({ timesPerWeek: 3 });
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs ${bf ? "text-bf-muted" : "text-white/55"}`}>
      <select value={mode} onChange={(e) => switchTo(e.target.value as Mode)} aria-label="How it repeats" className={field}>
        <option value="days">On these days</option>
        <option value="every">Every few days</option>
        <option value="monthDay">Monthly</option>
        <option value="timesPerWeek">Times a week</option>
      </select>
      {mode === "days" && (
        <DayPicker value={value.days ?? ALL_DAYS} onChange={(days) => onChange(days.length === 7 ? {} : { days })} bf={bf} />
      )}
      {mode === "every" && (
        <label className="flex items-center gap-1.5">
          Every
          <select value={value.every} onChange={(e) => onChange({ every: Number(e.target.value) })} aria-label="Every how many days" className={field}>
            {Array.from(new Set([...EVERY_OPTIONS, value.every!]))
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
          days
        </label>
      )}
      {mode === "monthDay" && (
        <label className="flex items-center gap-1.5">
          On the
          <select value={value.monthDay} onChange={(e) => onChange({ monthDay: Number(e.target.value) })} aria-label="Day of the month" className={field}>
            {range(1, 31).map((n) => (
              <option key={n} value={n}>
                {ordinal(n)}
              </option>
            ))}
          </select>
          {value.monthDay! > 28 && <span className={bf ? "text-bf-muted" : "text-white/45"}>Shorter months use their last day.</span>}
        </label>
      )}
      {mode === "timesPerWeek" && (
        <label className="flex items-center gap-1.5">
          <select value={value.timesPerWeek} onChange={(e) => onChange({ timesPerWeek: Number(e.target.value) })} aria-label="Times a week" className={field}>
            {range(1, 6).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          times a week, any day. It shows up daily until you get there.
        </label>
      )}
    </div>
  );
}

function DayPicker({ value, onChange, bf }: { value: number[]; onChange: (days: number[]) => void; bf: boolean }) {
  return (
    <div className="flex gap-1">
      {DAY_LETTERS.map((letter, d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => {
              if (on && value.length === 1) return;
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
            }}
            aria-pressed={on}
            aria-label={DAY_NAMES[d]}
            title={DAY_NAMES[d]}
            className={`h-7 w-7 rounded-full text-[11px] font-semibold transition ${
              on ? "bg-gold text-black" : bf ? "border border-bf-line text-bf-muted" : "border border-white/20 text-white/55 hover:border-gold/50 hover:text-gold"
            }`}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}
