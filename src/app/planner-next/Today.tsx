"use client";

import { useEffect, useRef, useState } from "react";
import { loadTodos, startFocus, stopFocus, toggleTodo, type Todo } from "@/lib/todos";
import { dayProgress } from "@/lib/plannerToday";
import type { Goal } from "@/lib/plannerSettings";
import { fmtDuration } from "../todos/planner";
import { AddBox, type Destination } from "./AddBox";
import { Attention } from "./Attention";
import { CurrentCard } from "./CurrentCard";
import { DayLogMore } from "./DayLogMore";
import { LogTiles } from "./LogTiles";
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

// The day shown: progress, what's on now, what needs a decision, the day log, the add box and the tasks.
export function Today({ day }: { day: Day }) {
  const { date, today, todos, log, setLog, now, focus, setFocus, refresh, flash } = day;
  const [logOpen, setLogOpen] = useState(false);
  const [destination, setDestination] = useState<Destination>({ kind: "day" });
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // N or / jumps to the add box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], [role=dialog]"))) return;
      if (e.key === "n" || e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!date || !today) return null;
  const isToday = date === today;

  const tick = (t: Todo) => {
    toggleTodo(t.id, date);
    refresh();
  };
  const beginFocus = (t: Todo) => {
    setFocus(startFocus(t, date));
    refresh(); // a session stopped by this one has just been recorded
  };
  const endFocus = (markDone: boolean) => {
    if (!focus) return;
    const minutes = Math.round((Date.now() - focus.startedAt) / 60000);
    stopFocus();
    setFocus(null);
    if (markDone && loadTodos(focus.date).some((t) => t.id === focus.todoId && !t.completed)) toggleTodo(focus.todoId, focus.date);
    refresh();
    flash(minutes > 0 ? `Recorded ${fmtDuration(minutes)} on “${focus.text}”` : "Under a minute, so nothing was recorded");
  };
  const wrapUp = () => {
    setLogOpen(true);
    setTimeout(() => logRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 0);
  };
  const addStep = (goal: Goal) => {
    setDestination({ kind: "goal", id: goal.id });
    inputRef.current?.focus();
  };

  const card = isToday && (
    <CurrentCard todos={todos} now={now} focus={focus} onFinish={tick} onFocus={beginFocus} onStopFocus={endFocus} onWrapUp={wrapUp} />
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
          <Tasks todos={todos} date={date} today={today} onTick={tick} onFocus={beginFocus} />
        </div>
      </div>
    </div>
  );
}
