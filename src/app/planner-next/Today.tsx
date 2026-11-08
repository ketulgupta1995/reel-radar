"use client";

import { useEffect, useRef, useState } from "react";
import { deleteTodo, loadTodos, moveTodoToDate, reorderTodo, restoreTodo, shiftDate, sortTodos, startFocus, stopFocus, toggleTodo, type Todo } from "@/lib/todos";
import { dayProgress, todayCard } from "@/lib/plannerToday";
import type { Goal } from "@/lib/plannerSettings";
import { fmtDuration } from "../todos/planner";
import { AddBox, type Destination } from "./AddBox";
import { Attention } from "./Attention";
import { CurrentCard } from "./CurrentCard";
import { DayLogMore } from "./DayLogMore";
import { FocusScreen } from "./FocusScreen";
import { LogTiles } from "./LogTiles";
import { TaskDetails } from "./TaskDetails";
import { Tasks } from "./Tasks";
import type { Day } from "./useDay";

function Progress({ todos }: { todos: Todo[] }) {
  const p = dayProgress(todos);
  return (
    <div>
      <div className="flex justify-between gap-2 font-bfm text-[11px] text-bf-muted tabular-nums">
        <span>
          {p.done} of {p.total} done
        </span>
        {p.plannedMinutes > 0 && (
          <span>
            {fmtDuration(p.doneMinutes)} of {fmtDuration(p.plannedMinutes)} planned
          </span>
        )}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bf-s2" role="progressbar" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done}>
        <div className="h-full rounded-full bg-bf-ink transition-[width]" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

// The task F and Space act on: the block under way, else the one being focused on, else what's next.
function currentTask(todos: Todo[], now: number, focusId?: string): Todo | null {
  const card = todayCard(todos, now);
  if (card?.kind === "block") return card.todo;
  const focused = focusId && todos.find((t) => t.id === focusId && !t.completed);
  if (focused) return focused;
  return card?.kind === "free" ? card.next ?? card.anytime[0] ?? null : null;
}

// The day shown: progress, what's on now, what needs a decision, the day log, the add box and the tasks.
export function Today({ day }: { day: Day }) {
  const { date, today, todos, log, setLog, now, focus, setFocus, refresh, flash, removed } = day;
  const [logOpen, setLogOpen] = useState(false);
  const [destination, setDestination] = useState<Destination>({ kind: "day" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusScreen, setFocusScreen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});

  // N or / jumps to the add box; on today, F focuses on the current task, Space finishes it, L opens the log.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest("input, textarea, select, button, a, [contenteditable], [role=dialog]"))) return;
      keys.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setOpenId(null), [date]);

  if (!date || !today) return null;
  const isToday = date === today;

  const tick = (t: Todo) => {
    toggleTodo(t.id, date);
    refresh();
  };
  const beginFocus = (t: Todo) => {
    setFocus(startFocus(t, date));
    setFocusScreen(true);
    refresh(); // a session stopped by this one has just been recorded
  };
  const endFocus = (markDone: boolean) => {
    if (!focus) return;
    const minutes = Math.round((Date.now() - focus.startedAt) / 60000);
    stopFocus();
    setFocus(null);
    setFocusScreen(false);
    if (markDone && loadTodos(focus.date).some((t) => t.id === focus.todoId && !t.completed)) toggleTodo(focus.todoId, focus.date);
    refresh();
    flash(minutes > 0 ? `Recorded ${fmtDuration(minutes)} on “${focus.text}”` : "Under a minute, so nothing was recorded");
  };
  const openLog = () => {
    setLogOpen(true);
    setTimeout(() => logRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 0);
  };
  const addStep = (goal: Goal) => {
    setDestination({ kind: "goal", id: goal.id });
    inputRef.current?.focus();
  };
  const swipeDone = (t: Todo) => {
    toggleTodo(t.id, date);
    refresh();
    flash(`Done: ${t.text}`, () => {
      toggleTodo(t.id, date);
      day.setMessage(null);
      refresh();
    });
  };
  const toTomorrow = (t: Todo) => {
    const tomorrow = shiftDate(date, 1);
    const schedule = t.start !== undefined ? { start: t.start, duration: t.duration } : undefined;
    if (moveTodoToDate(t.id, date, tomorrow, schedule) === null) {
      flash("Repeating tasks stay on their own day");
      return;
    }
    refresh();
    // Undo puts the task back as it was, so the move doesn't count as postponing it.
    flash(`Moved “${t.text}” to tomorrow`, () => {
      deleteTodo(t.id, tomorrow);
      restoreTodo(t, date);
      day.setMessage(null);
      refresh();
    });
  };
  const moveBy = (t: Todo, delta: -1 | 1) => {
    const ids = sortTodos(todos).filter((x) => !x.completed).map((x) => x.id);
    const at = ids.indexOf(t.id);
    if (at + delta < 0 || at + delta >= ids.length) return;
    reorderTodo(t.id, delta < 0 ? ids[at - 1] : ids[at + 2] ?? null, date);
    refresh();
  };

  keys.current = (e) => {
    if (e.key === "n" || e.key === "/") {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (!isToday) return;
    const current = currentTask(todos, now, focus?.todoId);
    if (e.key === "f" && current) {
      if (focus?.todoId === current.id) setFocusScreen(true);
      else beginFocus(current);
    } else if (e.key === " " && current) {
      e.preventDefault();
      if (focus?.todoId === current.id) endFocus(true);
      else {
        tick(current);
        flash(`Done: ${current.text}`);
      }
    } else if (e.key === "l") openLog();
  };

  const opened = openId ? todos.find((t) => t.id === openId) : undefined;
  const card = isToday && (
    <CurrentCard todos={todos} now={now} focus={focus} onFinish={tick} onFocus={beginFocus} onStopFocus={endFocus} onOpenFocus={() => setFocusScreen(true)} onWrapUp={openLog} />
  );
  const logPanel = (
    <div ref={logRef}>
      <LogTiles date={date} log={log} onChange={setLog} onMore={() => setLogOpen((o) => !o)} moreOpen={logOpen} />
      {logOpen && <DayLogMore date={date} log={log} onChange={setLog} />}
    </div>
  );

  // Phone: one column, card → attention → log → tasks. Laptop: card beside the log, tasks beside attention.
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-3 pb-36 pt-3 lg:px-6 lg:pb-12">
      <Progress todos={todos} />
      <div className="grid items-start gap-2.5 lg:grid-cols-[1.4fr_1fr] lg:gap-4">
        {card && <div className="order-1 lg:col-start-1 lg:row-start-1">{card}</div>}
        <div className="order-2 lg:col-start-2 lg:row-start-2">
          <Attention day={day} onAddStep={addStep} />
        </div>
        <div className="order-3 lg:col-start-2 lg:row-start-1">{logPanel}</div>
        <div className="order-4 flex flex-col gap-2.5 lg:col-start-1 lg:row-start-2">
          <AddBox date={date} destination={destination} onDestination={setDestination} inputRef={inputRef} onAdded={refresh} onMessage={flash} />
          <Tasks
            todos={todos}
            date={date}
            today={today}
            onReorder={(id, before) => {
              reorderTodo(id, before, date);
              refresh();
            }}
            actions={{ onTick: tick, onFocus: beginFocus, onOpen: (t) => setOpenId(t.id), onSwipeDone: swipeDone, onSwipeTomorrow: toTomorrow, onMoveBy: moveBy }}
          />
        </div>
      </div>
      {opened && <TaskDetails todo={opened} date={date} onClose={() => setOpenId(null)} onChanged={refresh} onFocus={beginFocus} onMessage={flash} onRemoved={removed} />}
      {focus && focusScreen && <FocusScreen session={focus} onClose={() => setFocusScreen(false)} onStop={endFocus} onChanged={refresh} />}
    </div>
  );
}
