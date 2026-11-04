"use client";

import { useEffect, useMemo, useState } from "react";
import { computeMonth, heatLevel } from "@/lib/plannerInsights";
import { getTodayDate, loadAllTodos, loadDailyTasks, syncPlanner, usePlannerSync, weekday, type DailyTask, type Todo } from "@/lib/todos";
import { DAY_NAMES, formatShortDate } from "./planner";
import { TableToggle, Tip } from "./stats/parts";

// One hue from dim to bright, checked for steady steps and 2:1 contrast on `panel`.
const HEAT = ["#5c4d31", "#86703b", "#bd9a48", "#f6c453"];
const HEAT_LABELS = ["1–2", "3–4", "5–7", "8+"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const cellLabel = (date: string, done: number, total: number) =>
  `${formatShortDate(date)}: ${total ? `${done} of ${total} ${total === 1 ? "task" : "tasks"} finished` : "nothing planned"}`;

// A month as a heatmap of finished tasks. Clicking a day opens it.
export default function MonthView({ selectedDate, onPick }: { selectedDate: string; onPick: (date: string) => void }) {
  const month = selectedDate.slice(0, 7);
  const first = `${month}-01`;
  const [data, setData] = useState<{ days: Record<string, Todo[]>; daily: DailyTask[] } | null>(null);
  const reload = () => setData({ days: loadAllTodos(), daily: loadDailyTasks() });

  useEffect(() => {
    reload();
    syncPlanner([first]).then((changed) => {
      if (changed) reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);
  usePlannerSync([first], reload);

  const summary = useMemo(() => (data ? computeMonth(data.days, data.daily, month) : null), [data, month]);
  if (!summary) return null;

  const today = getTodayDate();
  const blanks = (weekday(first) + 6) % 7;
  const tiles = [
    { label: "Finished", value: String(summary.done), sub: `${summary.done === 1 ? "task" : "tasks"} this month` },
    { label: "Active days", value: String(summary.activeDays), sub: `of ${summary.days.length}` },
    { label: "Best day", value: summary.best ? formatShortDate(summary.best.date) : "–", sub: summary.best ? `${summary.best.done} finished` : "nothing finished yet" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/10 bg-panel/60 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="truncate text-[11px] uppercase tracking-wider text-white/45">{t.label}</div>
            <div className="mt-1 text-lg font-semibold sm:text-2xl">{t.value}</div>
            <div className="text-[11px] text-white/45 sm:text-xs">{t.sub}</div>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-white/10 bg-panel/60 p-3 sm:p-5">
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
          {WEEK_ORDER.map((d) => (
            <div key={d} className="pb-1 text-center text-[11px] text-white/50">
              {DAY_NAMES[d]}
            </div>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {summary.days.map((d) => {
            const level = heatLevel(d.done);
            return (
              <button
                key={d.date}
                onClick={() => onPick(d.date)}
                aria-label={cellLabel(d.date, d.done, d.total)}
                aria-current={d.date === today ? "date" : undefined}
                style={level ? { background: HEAT[level - 1] } : undefined}
                className={`group relative flex h-12 flex-col items-start justify-between rounded p-1 text-left outline-none transition hover:ring-2 hover:ring-white/50 focus:ring-2 focus:ring-white/70 sm:h-20 sm:p-2 ${
                  level ? "" : "bg-white/[.04]"
                } ${level >= 3 ? "text-black" : "text-white"} ${d.date === today ? "ring-2 ring-gold ring-offset-1 ring-offset-panel" : ""}`}
              >
                <Tip>{cellLabel(d.date, d.done, d.total)}</Tip>
                <span className={`text-[11px] ${level >= 3 ? "text-black/70" : d.date > today ? "text-white/35" : "text-white/60"}`}>{Number(d.date.slice(8))}</span>
                {d.done > 0 && <span className="self-end text-sm font-semibold tabular-nums sm:text-lg">{d.done}</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
          <span>Tasks finished</span>
          {HEAT.map((color, i) => (
            <span key={color} className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
              {HEAT_LABELS[i]}
            </span>
          ))}
        </div>
        <TableToggle
          head={["Date", "Finished", "Planned"]}
          rows={summary.days.filter((d) => d.total > 0).map((d) => [formatShortDate(d.date), d.done, d.total])}
        />
      </section>
    </div>
  );
}
