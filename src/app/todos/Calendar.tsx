"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  copyTodoToDate,
  DEFAULT_DURATION,
  getTodayDate,
  loadAllDayLogs,
  loadAllTodos,
  loadDailyTasks,
  loadTodos,
  loadTodosWithDaily,
  moveTodoToDate,
  scheduleTodo,
  shiftDate,
  syncPlanner,
  toggleTodo,
  usePlannerSync,
  weekday,
  type DailyTask,
  type DayLog,
  type Todo,
} from "@/lib/todos";
import { computeMonth, heatLevel } from "@/lib/plannerInsights";
import { weekStart } from "@/lib/plannerStats";
import { activeLogItems, tagColor } from "@/lib/plannerSettings";
import { DAY_NAMES, HOUR_PX, SNAP, clampStart, fmtDuration, fmtTime, formatShortDate, getRelativeDateLabel, layoutBlocks, shiftMonth, snap, useBlockResize } from "./planner";

export type CalendarView = "week" | "month";
const DAY_START = 6 * 60; // the phone's week bars run from 6 AM to midnight
const SPAN = 24 * 60 - DAY_START;
const HEAT = ["bg-gold/25", "bg-gold/45", "bg-gold/70", "bg-gold"];
const HEAT_LABELS = ["1–2", "3–4", "5–7", "8+"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MAX_CHIPS = 4;

// Holding Ctrl, Alt/Option or Cmd while dropping copies instead of moving.
const isCopy = (e: React.DragEvent) => e.ctrlKey || e.altKey || e.metaKey;

// The week's seven days, kept current with this device and the server.
function useWeek(anchor: string) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(anchor), i)), [anchor]);
  const [week, setWeek] = useState<Record<string, Todo[]>>({});
  const reload = () => setWeek(Object.fromEntries(days.map((d) => [d, loadTodosWithDaily(d)])));
  useEffect(() => {
    let cancelled = false;
    setWeek(Object.fromEntries(days.map((d) => [d, loadTodos(d)])));
    // Like a day: sync the week's months (one request) before adding repeating tasks' copies.
    syncPlanner(days).then(() => {
      if (!cancelled) reload();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  usePlannerSync(days, reload);
  return { days, week, reload };
}

// Moving or copying a dragged task to a day, at a time or (null) as a task with no time.
function useDropOnDay(reload: () => void, flash: (text: string) => void) {
  const [over, setOver] = useState<{ date: string; minutes: number | null; copy: boolean } | null>(null);
  const dragOver = (e: React.DragEvent, date: string, minutes: number | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = isCopy(e) ? "copy" : "move";
    setOver({ date, minutes, copy: isCopy(e) });
  };
  const drop = (e: React.DragEvent, date: string, minutes: number | null | "keep") => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/todo-id");
    const from = e.dataTransfer.getData("text/todo-date");
    const todo = from ? loadTodos(from).find((t) => t.id === id) : undefined;
    if (!todo) return;
    const duration = todo.duration ?? DEFAULT_DURATION;
    const at = minutes === "keep" ? todo.start ?? null : minutes;
    const schedule = at === null ? undefined : { start: clampStart(at, duration), duration };
    if (isCopy(e)) {
      copyTodoToDate(id, from, date, schedule);
      flash(`Copied to ${getRelativeDateLabel(date)}`);
      return reload();
    }
    if (moveTodoToDate(id, from, date, schedule) === null) return flash("Repeating tasks stay on their own day. Hold Ctrl or Alt while dropping to copy it instead.");
    if (from !== date) flash(`Moved to ${getRelativeDateLabel(date)}`);
    reload();
  };
  return { over, setOver, dragOver, drop };
}

const dragStart = (e: React.DragEvent, t: Todo, date: string) => {
  e.dataTransfer.setData("text/todo-id", t.id);
  e.dataTransfer.setData("text/todo-date", date);
  e.dataTransfer.effectAllowed = "copyMove";
};

function WeekSummary({ days, week }: { days: string[]; week: Record<string, Todo[]> }) {
  const all = days.flatMap((d) => week[d] ?? []);
  const planned = all.reduce((n, t) => n + (t.start !== undefined ? t.duration ?? DEFAULT_DURATION : 0), 0);
  return (
    <p className="font-bfm text-[11px] text-bf-muted">
      {all.filter((t) => t.completed).length}/{all.length} done · {planned ? fmtDuration(planned) : "nothing"} planned
    </p>
  );
}

// The phone's week: a row a day, with its blocks on a thin 6 AM–midnight bar. Tap a day to open it;
// drag a block onto another day to move it there at the same time (hold Ctrl or Alt to copy).
type Week = ReturnType<typeof useWeek>;

function WeekRows({ data, onOpenDay, flash }: { data: Week; onOpenDay: (date: string) => void; flash: (text: string) => void }) {
  const { days, week, reload } = data;
  const { over, setOver, dragOver, drop } = useDropOnDay(reload, flash);
  const today = getTodayDate();
  const pct = (m: number) => Math.max(0, ((m - DAY_START) / SPAN) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <WeekSummary days={days} week={week} />
      {days.map((d) => {
        const list = week[d] ?? [];
        const blocks = list.filter((t) => t.start !== undefined);
        const loose = list.filter((t) => t.start === undefined && !t.completed).length;
        return (
          <div
            key={d}
            data-day={d}
            onDragOver={(e) => dragOver(e, d, null)}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => drop(e, d, "keep")}
            className={`grid grid-cols-[52px_1fr_44px] items-center gap-2.5 rounded-[14px] bg-bf-s1 p-2.5 ${d === today ? "ring-2 ring-bf-ink" : ""} ${over?.date === d ? "ring-2 ring-gold" : ""}`}
          >
            <button onClick={() => onOpenDay(d)} aria-label={`Open ${getRelativeDateLabel(d)}`} className="text-left text-xs font-black uppercase leading-tight [font-stretch:115%]">
              {DAY_NAMES[weekday(d)]}
              <b className="block font-bfm text-[22px]">{Number(d.slice(8))}</b>
            </button>
            <div className="relative h-[30px] rounded-[7px] bg-bf-s2">
              {blocks.map((t) => (
                <span
                  key={t.id}
                  draggable
                  onDragStart={(e) => dragStart(e, t, d)}
                  title={`${t.text} · ${fmtTime(t.start!)}`}
                  className={`absolute bottom-[3px] top-[3px] cursor-grab rounded ${!t.completed && d < today ? "opacity-35" : ""} ${t.completed ? "opacity-60" : ""}`}
                  style={{ left: `${pct(t.start!)}%`, width: `max(4px, ${((t.duration ?? DEFAULT_DURATION) / SPAN) * 100}%)`, background: tagColor(t.tag ?? "") }}
                />
              ))}
              {loose > 0 && <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-bfm text-[10px] text-bf-muted">+{loose} any time</span>}
            </div>
            <span className="text-right font-bfm text-xs font-bold tabular-nums">
              {list.filter((t) => t.completed).length}/{list.length}
            </span>
          </div>
        );
      })}
      <p className="px-1 font-bfm text-[11px] text-bf-muted">6 AM to midnight · tap a day to open it · drag a block to another day to move it</p>
    </div>
  );
}

// The laptop's week: seven columns by the hour, with each day's tasks that have no time on top.
function WeekColumns({ data, now, onOpenDay, flash }: { data: Week; now: number; onOpenDay: (date: string) => void; flash: (text: string) => void }) {
  const { days, week, reload } = data;
  const { over, setOver, dragOver, drop } = useDropOnDay(reload, flash);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = getTodayDate();
  const resize = useBlockResize((t, date, duration) => {
    scheduleTodo(t.id, { start: t.start!, duration }, date);
    reload();
  });
  // Scroll to the week's earliest block, or 7 AM.
  useEffect(() => {
    const starts = days.flatMap((d) => loadTodos(d).filter((t) => t.start !== undefined).map((t) => t.start!));
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, ((starts.length ? Math.min(...starts) : 7 * 60) / 60 - 1) * HOUR_PX);
  }, [days]);
  const minutesAt = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(snap(((e.clientY - rect.top) / HOUR_PX) * 60), 24 * 60 - SNAP));
  };
  const cols = "grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] gap-x-1.5";

  return (
    <div className="flex flex-col gap-2">
      <WeekSummary days={days} week={week} />
      <div ref={scrollRef} className="h-[70vh] overflow-auto rounded-[14px]">
        <div className="sticky top-0 z-30 bg-bf-bg pb-1.5">
          <div className={cols}>
            <div />
            {days.map((d) => {
              const list = week[d] ?? [];
              const done = list.filter((t) => t.completed).length;
              return (
                <button key={d} onClick={() => onOpenDay(d)} aria-label={`Open ${getRelativeDateLabel(d)}`} className={`rounded-t-[14px] bg-bf-s1 px-2 pt-2 text-left ${d === today ? "ring-2 ring-inset ring-bf-ink" : ""}`}>
                  <span className="flex justify-between text-xs font-black uppercase [font-stretch:115%]">
                    {DAY_NAMES[weekday(d)]} {Number(d.slice(8))}
                    <span className="font-bfm font-medium text-bf-muted">{list.length ? `${done}/${list.length}` : "–"}</span>
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-bf-s2">
                    <span className="block h-full bg-bf-ink" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className={cols}>
            <div className="py-1.5 text-right font-bfm text-[10px] leading-tight text-bf-muted">To do</div>
            {days.map((d) => {
              const loose = (week[d] ?? []).filter((t) => t.start === undefined && !t.completed);
              return (
                <div
                  key={d}
                  data-todo-strip={d}
                  onDragOver={(e) => dragOver(e, d, null)}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => drop(e, d, null)}
                  className={`min-h-[2.25rem] space-y-1 rounded-b-[14px] bg-bf-s1 p-1 ${over?.date === d && over.minutes === null ? "ring-2 ring-inset ring-gold" : ""}`}
                >
                  {loose.slice(0, MAX_CHIPS).map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => dragStart(e, t, d)}
                      onClick={() => onOpenDay(d)}
                      title={`${t.text} - drag into a time slot`}
                      className="cursor-grab truncate rounded-md bg-bf-s2 px-1.5 py-0.5 text-[11px] font-bold"
                      style={t.tag ? { boxShadow: `inset 3px 0 0 ${tagColor(t.tag)}` } : undefined}
                    >
                      {t.text}
                    </div>
                  ))}
                  {loose.length > MAX_CHIPS && (
                    <button onClick={() => onOpenDay(d)} className="px-1 font-bfm text-[10px] text-bf-muted">
                      +{loose.length - MAX_CHIPS} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className={cols} style={{ height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="absolute right-1 -translate-y-1/2 font-bfm text-[10px] text-bf-muted" style={{ top: (i + 1) * HOUR_PX }}>
                {fmtTime((i + 1) * 60).replace(" ", "")}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const blocks = (week[d] ?? []).filter((t) => t.start !== undefined);
            const lanes = layoutBlocks(blocks);
            return (
              <div
                key={d}
                data-day-column={d}
                className="relative rounded-[8px] bg-bf-s1/60"
                onDragOver={(e) => dragOver(e, d, minutesAt(e))}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => drop(e, d, minutesAt(e))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-bf-s2" style={{ top: h * HOUR_PX }} />
                ))}
                {over?.date === d && over.minutes !== null && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-gold" style={{ top: (over.minutes / 60) * HOUR_PX }}>
                    <span className="absolute -top-2.5 right-0 rounded bg-gold px-1 font-bfm text-[10px] font-bold text-bf-ontag">
                      {over.copy ? "Copy · " : ""}
                      {fmtTime(over.minutes)}
                    </span>
                  </div>
                )}
                {d === today && <div aria-label={`Now, ${fmtTime(now)}`} className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-bf-ink" style={{ top: (now / 60) * HOUR_PX }} />}
                {blocks.map((t) => {
                  const resizing = resize.preview?.id === t.id;
                  const duration = resizing ? resize.preview!.duration : t.duration ?? DEFAULT_DURATION;
                  return (
                    <div
                      key={t.id}
                      data-block={t.id}
                      draggable
                      onDragStart={(e) => (resize.active.current ? e.preventDefault() : dragStart(e, t, d))}
                      onClick={() => !resize.active.current && onOpenDay(d)}
                      title={`${t.text} · ${fmtTime(t.start!)}–${fmtTime(t.start! + duration)}`}
                      className={`absolute inset-x-0.5 z-10 cursor-grab overflow-hidden rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-extrabold leading-tight text-bf-ontag ${t.completed ? "opacity-40" : ""} ${resizing ? "ring-2 ring-bf-ink" : ""}`}
                      style={{ top: ((t.start! + (lanes.get(t.id)?.shift ?? 0)) / 60) * HOUR_PX + 1, height: Math.max((duration / 60) * HOUR_PX - 2, 18), background: tagColor(t.tag ?? "") }}
                    >
                      <div className="flex items-start gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTodo(t.id, d);
                            reload();
                          }}
                          aria-label={t.completed ? `Mark “${t.text}” not done` : `Mark “${t.text}” done`}
                          className="mt-px grid h-3 w-3 shrink-0 place-items-center rounded-sm border border-bf-ontag text-[8px]"
                        >
                          {t.completed ? "✓" : ""}
                        </button>
                        <span className={`min-w-0 truncate ${t.completed ? "line-through" : ""}`}>{t.text}</span>
                      </div>
                      {(resizing || duration >= 45) && <div className="truncate font-bfm text-[9.5px] font-medium opacity-75">{resizing ? `${fmtTime(t.start!)} – ${fmtTime(t.start! + duration)}` : fmtTime(t.start!)}</div>}
                      <div onPointerDown={(e) => resize.start(e, t, d)} data-testid="resize-handle" className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize touch-none" />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="font-bfm text-[11px] text-bf-muted">Drag to move between days · hold Ctrl/Alt to copy · drag a bottom edge to resize · click a day to open it</p>
    </div>
  );
}

// A day's log score: how many of the log items in use were ticked or counted.
const logScore = (log: DayLog | undefined, ids: string[]) => ids.filter((id) => log?.ticks?.[id] || log?.counts?.[id]).length;

// A month as a heatmap of finished tasks, with each day's log score in its corner. Tap a day to open it.
function Month({ anchor, onOpenDay }: { anchor: string; onOpenDay: (date: string) => void }) {
  const month = anchor.slice(0, 7);
  const first = `${month}-01`;
  const [data, setData] = useState<{ days: Record<string, Todo[]>; daily: DailyTask[]; logs: Record<string, DayLog> } | null>(null);
  const reload = () => setData({ days: loadAllTodos(), daily: loadDailyTasks(), logs: loadAllDayLogs() });
  useEffect(() => {
    reload();
    syncPlanner([first]).then((changed) => changed && reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);
  usePlannerSync([first], reload);
  const summary = useMemo(() => (data ? computeMonth(data.days, data.daily, month) : null), [data, month]);
  if (!summary || !data) return null;
  const today = getTodayDate();
  const items = activeLogItems().map((i) => i.id);
  const label = (d: { date: string; done: number; total: number }, score: number) =>
    `${formatShortDate(d.date)}: ${d.total ? `${d.done} of ${d.total} ${d.total === 1 ? "task" : "tasks"} finished` : "nothing planned"}${score ? `, log ${score} of ${items.length}` : ""}`;
  const tiles = [
    { label: "Finished", value: String(summary.done), sub: `${summary.done === 1 ? "task" : "tasks"} this month` },
    { label: "Active days", value: String(summary.activeDays), sub: `of ${summary.days.length}` },
    { label: "Best day", value: summary.best ? formatShortDate(summary.best.date) : "–", sub: summary.best ? `${summary.best.done} finished` : "nothing finished yet" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[14px] bg-bf-s1 px-3 py-2.5">
            <div className="truncate font-bfm text-[10.5px] uppercase text-bf-muted">{t.label}</div>
            <div className="mt-1 text-lg font-black [font-stretch:110%] lg:text-2xl">{t.value}</div>
            <div className="font-bfm text-[10.5px] text-bf-muted">{t.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid max-w-3xl grid-cols-7 gap-[5px]">
        {WEEK_ORDER.map((d) => (
          <div key={d} className="pb-0.5 text-center font-bfm text-[10.5px] text-bf-muted">
            {DAY_NAMES[d]}
          </div>
        ))}
        {Array.from({ length: (weekday(first) + 6) % 7 }, (_, i) => (
          <div key={`blank-${i}`} />
        ))}
        {summary.days.map((d) => {
          const level = heatLevel(d.done);
          const score = logScore(data.logs[d.date], items);
          return (
            <button
              key={d.date}
              onClick={() => onOpenDay(d.date)}
              aria-label={label(d, score)}
              aria-current={d.date === today ? "date" : undefined}
              className={`flex aspect-square flex-col justify-between rounded-[10px] p-1.5 text-left font-bfm text-[13px] font-bold ${level ? `${HEAT[level - 1]} ${level >= 3 ? "text-bf-ontag" : ""}` : "bg-bf-s1"} ${d.date > today ? "opacity-60" : ""} ${
                d.date === today ? "ring-2 ring-bf-ink" : ""
              }`}
            >
              <span>{Number(d.date.slice(8))}</span>
              <span className="flex items-end justify-between text-[9.5px] font-medium">
                <span>{score ? `${score}/${items.length}` : ""}</span>
                {d.done > 0 && <span className="text-sm font-bold">{d.done}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-bfm text-[10.5px] text-bf-muted">
        <span>Tasks finished</span>
        {HEAT.map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            <span className={`h-3 w-3 rounded ${c}`} />
            {HEAT_LABELS[i]}
          </span>
        ))}
        <span>· corner: day log score</span>
      </div>
      <details className="font-bfm text-xs text-bf-muted">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr>
                {["Date", "Finished", "Planned", "Log"].map((h) => (
                  <th key={h} className="py-1 pr-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-bf-ink">
              {summary.days
                .filter((d) => d.total > 0 || logScore(data.logs[d.date], items))
                .map((d) => (
                  <tr key={d.date} className="border-t border-bf-s2">
                    <td className="py-1 pr-4">{formatShortDate(d.date)}</td>
                    <td className="py-1 pr-4">{d.done}</td>
                    <td className="py-1 pr-4">{d.total}</td>
                    <td className="py-1 pr-4">
                      {logScore(data.logs[d.date], items)}/{items.length}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// The Calendar tab: the week (rows on a phone, columns on a laptop) or the month, around `anchor`.
export function Calendar({
  anchor,
  view,
  now,
  onView,
  onAnchor,
  onOpenDay,
  flash,
}: {
  anchor: string;
  view: CalendarView;
  now: number;
  onView: (v: CalendarView) => void;
  onAnchor: (date: string) => void;
  onOpenDay: (date: string) => void;
  flash: (text: string) => void;
}) {
  const start = weekStart(anchor);
  const week = useWeek(anchor); // loaded once for both the phone's rows and the laptop's columns
  const title = view === "week" ? `${formatShortDate(start)} – ${formatShortDate(shiftDate(start, 6))}` : new Date(anchor + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const step = (n: number) => onAnchor(view === "week" ? shiftDate(anchor, 7 * n) : shiftMonth(anchor, n));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 pb-36 pt-3 lg:px-6 lg:pb-12">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-black uppercase [font-stretch:125%]">{title}</h2>
        <button onClick={() => step(-1)} aria-label={`Previous ${view}`} className="grid h-9 w-9 place-items-center rounded-[10px] bg-bf-s1">
          ‹
        </button>
        <button onClick={() => step(1)} aria-label={`Next ${view}`} className="grid h-9 w-9 place-items-center rounded-[10px] bg-bf-s1">
          ›
        </button>
      </div>
      <div role="group" aria-label="Calendar view" className="flex max-w-sm gap-1.5">
        {(["week", "month"] as const).map((v) => (
          <button key={v} onClick={() => onView(v)} aria-pressed={view === v} className={`flex-1 rounded-xl py-2.5 text-[13px] font-extrabold uppercase [font-stretch:115%] ${view === v ? "bg-bf-ink text-bf-bg" : "bg-bf-s1 text-bf-muted"}`}>
            {v}
          </button>
        ))}
      </div>
      {view === "month" ? (
        <Month anchor={anchor} onOpenDay={onOpenDay} />
      ) : (
        <>
          <div className="lg:hidden">
            <WeekRows data={week} onOpenDay={onOpenDay} flash={flash} />
          </div>
          <div className="hidden lg:block">
            <WeekColumns data={week} now={now} onOpenDay={onOpenDay} flash={flash} />
          </div>
        </>
      )}
    </div>
  );
}
