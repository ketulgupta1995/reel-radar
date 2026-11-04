"use client";

import { useState, type ReactNode } from "react";
import { sortTodos, type OverdueTodo, type Todo } from "@/lib/todos";
import { dueLabel, dueTone } from "./Deadlines";
import { PRIORITY_STYLE, formatShortDate } from "./planner";
import { SlippingHint } from "./Slipping";

// Stays mounted while empty, so a tray left open comes back open when its last task is undone.
// The page keys each tray by date, which closes it on another day.
function Tray({ empty, label, action, onAction, children }: { empty: boolean; label: string; action: string; onAction: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (empty) return null;
  return (
    <div className="mb-5 rounded-xl border border-gold/30 bg-gold/5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left text-white/80 hover:text-white"
          aria-expanded={open}
        >
          <span className={`text-gold transition ${open ? "rotate-90" : ""}`}>›</span>
          {label}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="hidden rounded-full border border-gold/40 px-3 py-1 text-xs text-gold hover:bg-gold/10 sm:block"
          >
            {open ? "Hide" : "Choose"}
          </button>
          <button
            onClick={onAction}
            className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-black hover:brightness-110"
          >
            {action}
          </button>
        </div>
      </div>
      {open && <ul className="divide-y divide-white/5 border-t border-gold/20">{children}</ul>}
    </div>
  );
}

const PriorityDot = ({ todo }: { todo: Todo }) => (
  <span className={`h-2 w-2 shrink-0 rounded-full ${todo.priority ? PRIORITY_STYLE[todo.priority].dot : "border border-white/30"}`} />
);

// Unfinished tasks from every past day.
export function OverdueTray({
  items,
  today,
  onMove,
  onDrop,
  onAddStep,
}: {
  items: OverdueTodo[];
  today: string;
  onMove: (items: OverdueTodo[]) => void;
  onDrop: (item: OverdueTodo) => void;
  onAddStep: (item: OverdueTodo, text: string) => void;
}) {
  return (
    <Tray
      empty={items.length === 0}
      label={`${items.length} overdue ${items.length === 1 ? "task" : "tasks"}`}
      action="Move all to today"
      onAction={() => onMove(items)}
    >
      {items.map((o) => (
        <li key={o.todo.id} className="px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PriorityDot todo={o.todo} />
            <span className="min-w-0 flex-1 basis-32 break-words text-white/80">{o.todo.text}</span>
            {o.todo.due && <span className={`rounded-full border px-2 py-0.5 text-xs ${dueTone(o.todo, o.date, today)}`}>{dueLabel(o.todo.due, today)}</span>}
            <span className="text-xs text-white/50">{formatShortDate(o.date)}</span>
            <button
              onClick={() => onDrop(o)}
              aria-label={`Drop “${o.todo.text}”`}
              className="shrink-0 text-xs text-white/55 hover:text-white"
            >
              Drop
            </button>
            <button
              onClick={() => onMove([o])}
              aria-label={`Move “${o.todo.text}” to today`}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold"
            >
              + Today
            </button>
          </div>
          <SlippingHint todo={o.todo} onDrop={() => onDrop(o)} onAddStep={(text) => onAddStep(o, text)} />
        </li>
      ))}
    </Tray>
  );
}

// Unfinished tasks from the day before, on days other than today.
export function CarryOverTray({ items, fromLabel, onAdd }: { items: Todo[]; fromLabel: string; onAdd: (ids?: string[]) => void }) {
  return (
    <Tray
      empty={items.length === 0}
      label={`${items.length} unfinished ${items.length === 1 ? "task" : "tasks"} from ${fromLabel}`}
      action="Add all"
      onAction={() => onAdd()}
    >
      {sortTodos(items).map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-4 py-2">
          <PriorityDot todo={t} />
          <span className="min-w-0 flex-1 break-words text-white/80">{t.text}</span>
          <button
            onClick={() => onAdd([t.id])}
            className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold"
          >
            + Add
          </button>
        </li>
      ))}
    </Tray>
  );
}
