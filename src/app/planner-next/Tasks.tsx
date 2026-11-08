"use client";

import { useMemo, useState } from "react";
import { DEFAULT_DURATION, getDailyStreak, sortTodos, type Todo } from "@/lib/todos";
import { loadGoals, tagColor, tagLabel } from "@/lib/plannerSettings";
import { daysUntil } from "../todos/Deadlines";
import { fmtDuration } from "../todos/planner";

function TimeBlock({ todo }: { todo: Todo }) {
  const base = "flex w-[62px] shrink-0 flex-col items-center justify-center self-stretch font-bfm text-xs font-bold leading-tight";
  if (todo.completed && todo.doneAt) {
    const d = new Date(todo.doneAt);
    const [t, p] = split(d.getHours() * 60 + d.getMinutes());
    return (
      <span className={`${base} ${todo.start !== undefined ? "text-bf-ontag" : "bg-bf-s2"}`} style={todo.start !== undefined ? { background: tagColor(todo.tag ?? "") } : undefined} title="When it was ticked">
        ✓ {t}
        <small className="text-[10px] font-medium opacity-75">{p}</small>
      </span>
    );
  }
  if (todo.start === undefined)
    return (
      <span className={`${base} bg-bf-s2 text-bf-muted`}>
        Any
        <small className="text-[10px] font-medium">time</small>
      </span>
    );
  const [t, p] = split(todo.start);
  return (
    <span className={`${base} text-bf-ontag`} style={{ background: tagColor(todo.tag ?? "") }}>
      {t}
      <small className="text-[10px] font-medium opacity-75">{p}</small>
    </span>
  );
}
// 480 → ["8:00", "AM"], so the period sits under the time in a block.
const split = (minutes: number): [string, string] => {
  const h = Math.floor(minutes / 60) % 24;
  return [`${h % 12 || 12}:${String(minutes % 60).padStart(2, "0")}`, h < 12 ? "AM" : "PM"];
};

function Markers({ todo, date, today, streak }: { todo: Todo; date: string; today: string; streak?: number }) {
  const goal = todo.goalId ? loadGoals().find((g) => g.id === todo.goalId) : undefined;
  const checked = todo.subtasks?.filter((s) => s.done).length ?? 0;
  const lateDue = todo.due && !todo.completed && (daysUntil(todo.due, today) < 0 || date > todo.due);
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-bfm text-[11px] text-bf-muted">
      {todo.start !== undefined && <span>{fmtDuration(todo.duration ?? DEFAULT_DURATION)}</span>}
      {todo.tag && (
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tagColor(todo.tag) }} />
          {tagLabel(todo.tag)}
        </span>
      )}
      {todo.priority === "high" && <span className="text-bf-late">⚑ High</span>}
      {todo.priority === "medium" && <span>⚑ Medium</span>}
      {todo.priority === "low" && <span>⚑ Low</span>}
      {streak ? <span>🔥 {streak}</span> : null}
      {todo.due && <span className={lateDue ? "text-bf-late" : ""}>🏁 {todo.due === today ? "today" : fmtDue(todo.due)}</span>}
      {goal && <span>◎ {goal.name}</span>}
      {todo.subtasks?.length ? (
        <span>
          ☑ {checked}/{todo.subtasks.length}
        </span>
      ) : null}
    </span>
  );
}
const fmtDue = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Row({ todo, date, today, streak, onTick, onFocus }: { todo: Todo; date: string; today: string; streak?: number; onTick: (t: Todo) => void; onFocus: (t: Todo) => void }) {
  return (
    <li data-task={todo.id} className={`flex min-h-[58px] items-center gap-3 overflow-hidden rounded-[14px] bg-bf-s1 pr-2.5 transition ${todo.completed ? "opacity-60" : ""}`}>
      <TimeBlock todo={todo} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5">
        <span className={`break-words text-[15px] font-bold ${todo.completed ? "line-through" : ""}`}>{todo.text}</span>
        <Markers todo={todo} date={date} today={today} streak={streak} />
      </div>
      {!todo.completed && (
        <button onClick={() => onFocus(todo)} aria-label={`Focus on “${todo.text}”`} className="h-[30px] w-[30px] shrink-0 rounded-lg bg-bf-s2 text-xs">
          ▶
        </button>
      )}
      <button
        onClick={() => onTick(todo)}
        aria-label={todo.completed ? `Mark “${todo.text}” not done` : `Mark “${todo.text}” done`}
        aria-pressed={todo.completed}
        className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-2 font-black ${todo.completed ? "border-bf-ink bg-bf-ink text-bf-bg" : "border-bf-line text-transparent"}`}
      >
        ✓
      </button>
    </li>
  );
}

// The day's tasks in time order, unscheduled ones after, and a Done group at the bottom with when each was ticked.
export function Tasks({ todos, date, today, onTick, onFocus }: { todos: Todo[]; date: string; today: string; onTick: (t: Todo) => void; onFocus: (t: Todo) => void }) {
  const [doneOpen, setDoneOpen] = useState(true);
  const open = sortTodos(todos).filter((t) => !t.completed);
  const done = todos.filter((t) => t.completed).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  const streaks = useMemo(() => new Map(todos.filter((t) => t.dailyId).map((t) => [t.id, getDailyStreak(t.dailyId!, date)])), [todos, date]);
  const row = (t: Todo) => <Row key={t.id} todo={t} date={date} today={today} streak={streaks.get(t.id)} onTick={onTick} onFocus={onFocus} />;

  if (!todos.length) return <p className="px-1 py-6 text-center text-sm text-bf-muted">Nothing planned yet. Add the first task above.</p>;
  return (
    <div>
      <ul aria-label="Tasks" className="flex flex-col gap-1.5">
        {open.map(row)}
      </ul>
      {done.length > 0 && (
        <>
          <button onClick={() => setDoneOpen((o) => !o)} aria-expanded={doneOpen} className="mt-2 flex w-full justify-between px-0.5 py-1.5 font-bfm text-[11px] uppercase tracking-[.08em] text-bf-muted">
            <span>Done · {done.length}</span>
            <span aria-hidden>{doneOpen ? "▴" : "▾"}</span>
          </button>
          {doneOpen && (
            <ul aria-label="Done" className="flex flex-col gap-1.5">
              {done.map(row)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
