"use client";

import { useMemo, useState } from "react";
import { DEFAULT_DURATION, getDailyStreak, sortTodos, type Todo } from "@/lib/todos";
import { loadGoals, tagColor, tagLabel } from "@/lib/plannerSettings";
import { daysUntil } from "../todos/Deadlines";
import { fmtDuration } from "../todos/planner";
import { useListReorder, type ListReorder } from "../todos/TodoItem";

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

const SWIPE = 90; // px a row must travel to count as a swipe
const AFTER_SWIPE_MS = 400;
// When the last swipe ended. Finishing a task moves its row, so the tap that ends the gesture can land on
// another row: any row ignores a tap this soon after.
let swipeEndedAt = -Infinity;
const justSwiped = () => Date.now() - swipeEndedAt < AFTER_SWIPE_MS;

// A row follows a finger sideways and, past SWIPE, finishes (right) or goes to tomorrow (left).
// A mouse never swipes, so dragging to select text on a laptop stays as it was.
function useSwipe(onRight: () => void, onLeft: () => void) {
  const [dx, setDx] = useState(0);
  const start = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" || (e.target as Element).closest("[data-noswipe]")) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let on = false;
    let last = 0;
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - x0;
      if (!on && Math.abs(x) > 10 && Math.abs(x) > Math.abs(ev.clientY - y0)) on = true;
      if (!on) return;
      last = x;
      setDx(x);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDx(0);
      if (!on) return;
      swipeEndedAt = Date.now(); // the click that follows the gesture isn't a tap
      if (last > SWIPE) onRight();
      else if (last < -SWIPE) onLeft();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  return { dx, start };
}

type RowActions = {
  onTick: (t: Todo) => void;
  onFocus: (t: Todo) => void;
  onOpen: (t: Todo) => void;
  onSwipeDone: (t: Todo) => void;
  onSwipeTomorrow: (t: Todo) => void;
  onMoveBy: (t: Todo, by: -1 | 1) => void;
};

function Row({ todo, date, today, streak, reorder, actions }: { todo: Todo; date: string; today: string; streak?: number; reorder: ListReorder; actions: RowActions }) {
  const swipe = useSwipe(
    () => !todo.completed && actions.onSwipeDone(todo),
    () => actions.onSwipeTomorrow(todo)
  );
  const lifted = reorder.drag?.id === todo.id;
  const shift = lifted ? reorder.drag!.dy : 0;
  return (
    <li
      data-task={todo.id}
      {...(!todo.completed ? { "data-reorder-id": todo.id } : {})}
      onPointerDown={swipe.start}
      // On a laptop, drag a task onto the day bar to schedule it.
      draggable={!todo.completed}
      onDragStart={(e) => e.dataTransfer.setData("text/todo-id", todo.id)}
      style={swipe.dx || shift ? { transform: `translate(${swipe.dx}px, ${shift}px)` } : undefined}
      className={`relative flex min-h-[58px] touch-pan-y items-center gap-3 overflow-hidden rounded-[14px] bg-bf-s1 pr-1.5 ${swipe.dx || lifted ? "z-10 shadow-lg" : "transition"} ${todo.completed ? "opacity-60" : ""} ${
        swipe.dx > SWIPE ? "ring-2 ring-emerald-500" : swipe.dx < -SWIPE ? "ring-2 ring-sky-500" : ""
      }`}
    >
      <TimeBlock todo={todo} />
      <button
        onClick={() => !justSwiped() && actions.onOpen(todo)}
        aria-label={`Open “${todo.text}”`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 self-stretch py-2.5 text-left"
      >
        <span className={`break-words text-[15px] font-bold ${todo.completed ? "line-through" : ""}`}>{todo.text}</span>
        <Markers todo={todo} date={date} today={today} streak={streak} />
      </button>
      {!todo.completed && (
        <button data-noswipe onClick={() => actions.onFocus(todo)} aria-label={`Focus on “${todo.text}”`} className="h-[30px] w-[30px] shrink-0 rounded-lg bg-bf-s2 text-xs">
          ▶
        </button>
      )}
      <button
        data-noswipe
        onClick={() => actions.onTick(todo)}
        aria-label={todo.completed ? `Mark “${todo.text}” not done` : `Mark “${todo.text}” done`}
        aria-pressed={todo.completed}
        className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg border-2 font-black ${todo.completed ? "border-bf-ink bg-bf-ink text-bf-bg" : "border-bf-line text-transparent"}`}
      >
        ✓
      </button>
      {todo.completed ? (
        <span className="w-6 shrink-0" />
      ) : (
        <button
          data-noswipe
          aria-label={`Drag to reorder ${todo.text}`}
          title="Drag to reorder (or use ↑ ↓ on the keyboard)"
          onPointerDown={(e) => {
            e.stopPropagation();
            reorder.start(e, todo.id);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            actions.onMoveBy(todo, e.key === "ArrowUp" ? -1 : 1);
          }}
          className={`h-8 w-6 shrink-0 touch-none select-none text-bf-line ${lifted ? "cursor-grabbing" : "cursor-grab"}`}
        >
          ⋮⋮
        </button>
      )}
    </li>
  );
}

const DropLine = () => <li aria-hidden data-testid="drop-line" className="-my-0.5 h-1 rounded-full bg-gold" />;

// The day's tasks in their order (time order unless rearranged), and a Done group at the bottom with when each was ticked.
export function Tasks({ todos, date, today, actions, onReorder }: { todos: Todo[]; date: string; today: string; actions: RowActions; onReorder: (id: string, before: string | null) => void }) {
  const [doneOpen, setDoneOpen] = useState(true);
  const reorder = useListReorder(onReorder);
  const open = sortTodos(todos).filter((t) => !t.completed);
  const done = todos.filter((t) => t.completed).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  const streaks = useMemo(() => new Map(todos.filter((t) => t.dailyId).map((t) => [t.id, getDailyStreak(t.dailyId!, date)])), [todos, date]);
  const row = (t: Todo) => <Row key={t.id} todo={t} date={date} today={today} streak={streaks.get(t.id)} reorder={reorder} actions={actions} />;

  if (!todos.length) return <p className="px-1 py-6 text-center text-sm text-bf-muted">Nothing planned yet. Add the first task above.</p>;
  return (
    <div>
      <div ref={reorder.listRef}>
        <ul aria-label="Tasks" className="flex flex-col gap-1.5">
          {open.flatMap((t) => (reorder.drag?.before === t.id ? [<DropLine key="drop" />, row(t)] : [row(t)]))}
          {reorder.drag && reorder.drag.before === null && <DropLine />}
        </ul>
      </div>
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
