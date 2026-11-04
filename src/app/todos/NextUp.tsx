"use client";

import { DEFAULT_DURATION, sortTodos, type Todo } from "@/lib/todos";
import { fmtTime } from "./planner";

// What to do now: the block under way, else the next one today, else the first task on the list.
export function nextUp(todos: Todo[], now: number): { todo: Todo; label: string } | null {
  const open = sortTodos(todos).filter((t) => !t.completed);
  const timed = open.filter((t) => t.start !== undefined).sort((a, b) => a.start! - b.start!);
  const current = timed.find((t) => now >= t.start! && now < t.start! + (t.duration ?? DEFAULT_DURATION));
  if (current) return { todo: current, label: "Now" };
  const soon = timed.find((t) => t.start! > now);
  if (soon) return { todo: soon, label: `Next · ${fmtTime(soon.start!)}` };
  return open[0] ? { todo: open[0], label: "Up next" } : null;
}

export function NextUpCard({ todos, now, onDone, onFocus }: { todos: Todo[]; now: number; onDone: (todo: Todo) => void; onFocus: (todo: Todo) => void }) {
  const next = nextUp(todos, now);
  if (!next) return null;
  return (
    <section aria-label="Next up" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3">
      <div className="min-w-0 flex-1 basis-40">
        <div className="text-[11px] uppercase tracking-wider text-gold">{next.label}</div>
        <div className="break-words font-semibold text-white">{next.todo.text}</div>
      </div>
      <div className="flex shrink-0 gap-2 text-xs">
        <button
          onClick={() => onFocus(next.todo)}
          aria-label={`Focus on “${next.todo.text}”`}
          className="rounded-full border border-white/20 px-3 py-1.5 text-white/80 hover:border-gold/50 hover:text-gold"
        >
          ▶ Start
        </button>
        <button
          onClick={() => onDone(next.todo)}
          aria-label={`Finish “${next.todo.text}”`}
          className="rounded-full bg-gold px-3 py-1.5 font-semibold text-black hover:brightness-110"
        >
          ✓ Done
        </button>
      </div>
    </section>
  );
}
