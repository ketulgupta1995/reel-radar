"use client";

import { useState } from "react";
import type { OverdueTodo, Todo } from "@/lib/todos";
import { DAY_NAMES, formatShortDate } from "./planner";

const dayNumber = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export const daysUntil = (date: string, today: string) => dayNumber(date) - dayNumber(today);

// "Due tomorrow", "Due Fri", "Due Nov 8", "2 days late".
export function dueLabel(due: string, today: string): string {
  const left = daysUntil(due, today);
  if (left < 0) return `${-left} ${left === -1 ? "day" : "days"} late`;
  if (left === 0) return "Due today";
  if (left === 1) return "Due tomorrow";
  if (left < 7) return `Due ${DAY_NAMES[new Date(due + "T00:00:00").getDay()]}`;
  return `Due ${formatShortDate(due)}`;
}

// Red once it's late, or when the task is planned for after its deadline; gold when it's close.
export function dueTone(todo: Todo, date: string, today: string): string {
  if (todo.completed) return "border-white/15 text-white/45";
  const left = daysUntil(todo.due!, today);
  if (left < 0 || date > todo.due!) return "border-red-400/50 bg-red-500/10 text-red-300";
  return left <= 2 ? "border-gold/50 bg-gold/10 text-gold" : "border-white/15 text-white/60";
}

// Tasks with a deadline that's gone or coming up, wherever they're planned.
export function DueTray({
  items,
  today,
  onDone,
  onToday,
  onOpen,
}: {
  items: OverdueTodo[];
  today: string;
  onDone: (item: OverdueTodo) => void;
  onToday: (item: OverdueTodo) => void;
  onOpen: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const soonest = items[0];
  return (
    <section aria-label="Deadlines" className="mb-5 rounded-xl border border-gold/30 bg-gold/5 text-sm">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left text-white/85 hover:text-white">
        <span aria-hidden className={`text-gold transition ${open ? "rotate-90" : ""}`}>›</span>
        <span className="font-semibold">
          {items.length} {items.length === 1 ? "deadline" : "deadlines"} coming up
        </span>
        {!open && (
          <span className={`min-w-0 truncate rounded-full border px-2 py-0.5 text-xs ${dueTone(soonest.todo, soonest.date, today)}`}>
            {dueLabel(soonest.todo.due!, today)}
          </span>
        )}
      </button>
      {open && (
      <ul className="divide-y divide-white/5 border-t border-gold/20">
        {items.map((item) => (
          <li key={item.todo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <button
              onClick={() => onDone(item)}
              aria-label={`Mark “${item.todo.text}” as done`}
              className="h-4 w-4 shrink-0 rounded border-2 border-white/30 hover:border-gold/60"
            />
            <span className="min-w-0 flex-1 basis-32 break-words text-white/85">{item.todo.text}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${dueTone(item.todo, item.date, today)}`}>{dueLabel(item.todo.due!, today)}</span>
            {item.date !== today && (
              <>
                <button onClick={() => onOpen(item.date)} className="text-xs text-white/55 hover:text-white">
                  Planned {formatShortDate(item.date)}
                </button>
                <button
                  onClick={() => onToday(item)}
                  aria-label={`Move “${item.todo.text}” to today`}
                  className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-gold/50 hover:text-gold"
                >
                  + Today
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
