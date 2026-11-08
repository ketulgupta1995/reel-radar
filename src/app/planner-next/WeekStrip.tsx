"use client";

import { loadTodos, shiftDate, weekday, type Todo } from "@/lib/todos";
import { DAY_LETTERS, formatDate } from "../todos/planner";

// The days around the one shown, three either side, each with a bar for how much of it got done.
// It sits in the always-dark header. Only rendered after mount (it reads this browser's copy).
export function WeekStrip({ date, today, todos, onPick }: { date: string; today: string; todos: Todo[]; onPick: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = shiftDate(date, i - 3);
    const list = d === date ? todos : loadTodos(d);
    return { date: d, total: list.length, done: list.filter((t) => t.completed).length };
  });
  return (
    <div role="group" aria-label="Days around this one" className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const selected = d.date === date;
        const label = `${formatDate(d.date)}: ${d.total ? `${d.done} of ${d.total} done` : "nothing planned"}`;
        return (
          <button
            key={d.date}
            onClick={() => onPick(d.date)}
            aria-label={label}
            aria-current={selected ? "date" : undefined}
            title={label}
            className={`flex flex-col items-center rounded-[10px] py-1.5 ${selected ? "bg-white text-ink" : "bg-white/10 text-white/80 hover:bg-white/15"}`}
          >
            <span className={`font-bfm text-[10px] font-bold ${selected ? "text-ink/60" : "text-white/50"}`}>{DAY_LETTERS[weekday(d.date)]}</span>
            <span className="text-[15px] font-black tabular-nums">
              {Number(d.date.slice(8))}
              {d.date === today && !selected && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gold align-top" />}
            </span>
            <span className={`mt-0.5 h-1 w-6 overflow-hidden rounded-full ${selected ? "bg-ink/15" : "bg-white/10"}`}>
              {d.total > 0 && <span className={`block h-full rounded-full ${selected ? "bg-ink" : d.done === d.total ? "bg-emerald-400" : "bg-gold"}`} style={{ width: `${Math.max(8, (d.done / d.total) * 100)}%` }} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
