"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadTodos,
  loadTodosWithDaily,
  syncPlanner,
  usePlannerSync,
  moveTodoToDate,
  copyTodoToDate,
  scheduleTodo,
  toggleTodo,
  shiftDate,
  getTodayDate,
  DEFAULT_DURATION,
  type Todo,
} from "@/lib/todos";
import { weekStart } from "@/lib/plannerStats";
import {
  HOUR_PX,
  SNAP,
  DAY_NAMES,
  TAG_COLORS,
  TimeBlock,
  clampStart,
  fmtDuration,
  fmtTime,
  getRelativeDateLabel,
  layoutBlocks,
  snap,
  useBlockResize,
} from "./planner";

const COLS = "grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))]";
const MAX_CHIPS = 4;

export default function WeekView({
  anchorDate,
  now,
  onOpenDay,
  flash,
}: {
  anchorDate: string;
  now: number | null; // minutes since midnight
  onOpenDay: (date: string) => void;
  flash: (message: string) => void;
}) {
  const days = useMemo(() => {
    const first = weekStart(anchorDate);
    return Array.from({ length: 7 }, (_, i) => shiftDate(first, i));
  }, [anchorDate]);
  const [week, setWeek] = useState<Record<string, Todo[]>>({});
  const [dragOver, setDragOver] = useState<{ date: string; minutes: number | null; copy: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = getTodayDate();

  const reload = () => setWeek(Object.fromEntries(days.map((d) => [d, loadTodos(d)])));
  const resize = useBlockResize((t, date, duration) => {
    scheduleTodo(t.id, { start: t.start!, duration }, date);
    reload();
  });

  useEffect(() => {
    let cancelled = false;
    setWeek(Object.fromEntries(days.map((d) => [d, loadTodos(d)])));
    // Like the day view: sync the week's months (one request) before adding daily copies.
    syncPlanner(days).then(() => {
      if (!cancelled) setWeek(Object.fromEntries(days.map((d) => [d, loadTodosWithDaily(d)])));
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  usePlannerSync(days, () => setWeek(Object.fromEntries(days.map((d) => [d, loadTodosWithDaily(d)]))));

  // Scroll to the week's earliest block, or 7 AM.
  useEffect(() => {
    const starts = days.flatMap((d) => loadTodos(d).filter((t) => t.start !== undefined).map((t) => t.start!));
    const target = starts.length ? Math.min(...starts) : 7 * 60;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (target / 60 - 1) * HOUR_PX);
  }, [days]);

  const minutesAt = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(snap(((e.clientY - rect.top) / HOUR_PX) * 60), 24 * 60 - SNAP));
  };

  // Holding Ctrl, Alt/Option or Cmd while dropping copies instead of moving.
  const isCopy = (e: React.DragEvent) => e.ctrlKey || e.altKey || e.metaKey;

  const dragOverAt = (e: React.DragEvent, date: string, minutes: number | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = isCopy(e) ? "copy" : "move";
    setDragOver({ date, minutes, copy: isCopy(e) });
  };

  // minutes === null: dropped on a day's "to do" strip, so it ends up unscheduled.
  const drop = (e: React.DragEvent, date: string, minutes: number | null) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/todo-id");
    const from = e.dataTransfer.getData("text/todo-date");
    const todo = from ? loadTodos(from).find((t) => t.id === id) : undefined;
    if (!todo) return;
    const duration = todo.duration ?? DEFAULT_DURATION;
    const schedule = minutes === null ? undefined : { start: clampStart(minutes, duration), duration };
    if (isCopy(e)) {
      copyTodoToDate(id, from, date, schedule);
      flash(`Copied to ${getRelativeDateLabel(date)}`);
      reload();
      return;
    }
    if (moveTodoToDate(id, from, date, schedule) === null) {
      flash("Repeating tasks stay on their own day. Hold Ctrl or Alt while dropping to copy it instead.");
      return;
    }
    if (from !== date) flash(`Moved to ${getRelativeDateLabel(date)}`);
    reload();
  };

  const all = days.flatMap((d) => week[d] ?? []);
  const weekDone = all.filter((t) => t.completed).length;
  const weekPlanned = all.reduce((n, t) => n + (t.start !== undefined ? t.duration ?? DEFAULT_DURATION : 0), 0);

  return (
    <section className="rounded-2xl border border-white/10 bg-panel/60">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 px-4 py-3">
        <h2 className="font-semibold">Week</h2>
        <span className="text-xs text-white/55">
          {weekDone}/{all.length} done · {weekPlanned ? fmtDuration(weekPlanned) : "nothing"} planned
        </span>
        <p className="text-xs text-white/40 sm:ml-auto">
          Drag to move between days · hold Ctrl/Alt to copy · drag a bottom edge to resize · click a day to open it
        </p>
      </div>

      <div ref={scrollRef} className="h-[70vh] overflow-auto">
        <div className="min-w-[46rem]">
          {/* Day headers and each day's unscheduled tasks stay in view while scrolling. */}
          <div className="sticky top-0 z-30 border-b border-white/10 bg-panel">
            <div className={COLS}>
              <div />
              {days.map((d) => {
                const list = week[d] ?? [];
                const done = list.filter((t) => t.completed).length;
                const dateNum = Number(d.slice(8));
                return (
                  <button
                    key={d}
                    onClick={() => onOpenDay(d)}
                    className={`border-l border-white/10 px-2 py-2 text-left transition hover:bg-white/5 ${
                      d === today ? "text-gold" : ""
                    }`}
                    title={`Open ${getRelativeDateLabel(d)}`}
                  >
                    <div className="text-xs font-semibold">
                      {DAY_NAMES[new Date(d + "T00:00:00").getDay()]} {dateNum}
                    </div>
                    <div className="text-[11px] text-white/50">{list.length ? `${done}/${list.length} done` : "–"}</div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gold"
                        style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <div className={COLS}>
              <div className="px-1 py-1.5 text-right text-[10px] leading-tight text-white/40">To do</div>
              {days.map((d) => {
                const loose = (week[d] ?? []).filter((t) => t.start === undefined && !t.completed);
                return (
                  <div
                    key={d}
                    onDragOver={(e) => dragOverAt(e, d, null)}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => drop(e, d, null)}
                    className={`min-h-[2.25rem] space-y-1 border-l border-white/10 p-1 transition ${
                      dragOver?.date === d && dragOver.minutes === null ? "bg-gold/10" : ""
                    }`}
                  >
                    {loose.slice(0, MAX_CHIPS).map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/todo-id", t.id);
                          e.dataTransfer.setData("text/todo-date", d);
                          e.dataTransfer.effectAllowed = "copyMove";
                        }}
                        onClick={() => onOpenDay(d)}
                        className="cursor-grab truncate rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[11px] text-white/80 hover:border-gold/40"
                        style={t.tag ? { borderLeftColor: TAG_COLORS[t.tag], borderLeftWidth: 3 } : undefined}
                        title={`${t.text} - drag into a time slot`}
                      >
                        {t.text}
                      </div>
                    ))}
                    {loose.length > MAX_CHIPS && (
                      <button onClick={() => onOpenDay(d)} className="px-1 text-[10px] text-white/45 hover:text-gold">
                        +{loose.length - MAX_CHIPS} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className={COLS} style={{ height: 24 * HOUR_PX }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, i) => (
                <span
                  key={i}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] text-white/40"
                  style={{ top: (i + 1) * HOUR_PX }}
                >
                  {fmtTime((i + 1) * 60)}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const blocks = (week[d] ?? []).filter((t) => t.start !== undefined);
              const lanes = layoutBlocks(blocks);
              return (
                <div
                  key={d}
                  className={`relative border-l border-white/10 ${d === today ? "bg-gold/[.03]" : ""}`}
                  onDragOver={(e) => dragOverAt(e, d, minutesAt(e))}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => drop(e, d, minutesAt(e))}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      className="pointer-events-none absolute inset-x-0 border-t border-white/10"
                      style={{ top: h * HOUR_PX }}
                    />
                  ))}
                  {dragOver?.date === d && dragOver.minutes !== null && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-gold"
                      style={{ top: (dragOver.minutes / 60) * HOUR_PX }}
                    >
                      <span className="absolute -top-2.5 right-0 rounded bg-gold px-1 text-[10px] font-semibold text-black">
                        {dragOver.copy ? "Copy · " : ""}
                        {fmtTime(dragOver.minutes)}
                      </span>
                    </div>
                  )}
                  {d === today && now !== null && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
                      style={{ top: (now / 60) * HOUR_PX }}
                    />
                  )}
                  {blocks.map((t) => {
                    const { lane, lanes: count } = lanes.get(t.id) ?? { lane: 0, lanes: 1 };
                    return (
                      <TimeBlock
                        key={t.id}
                        todo={t}
                        date={d}
                        lane={lane}
                        lanes={count}
                        compact
                        resize={resize}
                        onSelect={() => onOpenDay(d)}
                        onToggle={(todo) => {
                          toggleTodo(todo.id, d);
                          reload();
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
