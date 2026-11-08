"use client";

import { useEffect } from "react";
import { toggleSubtask, type FocusSession } from "@/lib/todos";
import { tagColor, tagLabel } from "@/lib/plannerSettings";
import { useWakeLock } from "@/lib/useWakeLock";
import { focusClock, useClock } from "./CurrentCard";

// Focus, filling the screen in the task's colour: a large clock, the checklist to tick, Finish and Stop.
// The screen stays on while it's open. ✕ or Esc shrinks it back into the card, where the clock keeps going.
export function FocusScreen({ session, onClose, onStop, onChanged }: { session: FocusSession; onClose: () => void; onStop: (markDone: boolean) => void; onChanged: () => void }) {
  const nowMs = useClock(true);
  useWakeLock(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const f = focusClock(session, nowMs);
  const subtasks = f.todo?.subtasks ?? [];

  return (
    <div role="dialog" aria-label="Focus" className="fixed inset-0 z-50 flex flex-col gap-2.5 overflow-y-auto px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-bf-ontag" style={{ background: tagColor(f.todo?.tag ?? "") }}>
      <div className="flex items-center justify-between">
        <span className="font-bfm text-[11px] font-bold uppercase tracking-[.08em] opacity-75">Focus{f.todo?.tag ? ` · ${tagLabel(f.todo.tag)}` : ""}</span>
        <button onClick={onClose} aria-label="Minimise focus" className="px-2 py-1 text-xl">
          ✕
        </button>
      </div>
      <h2 className="mt-1 break-words text-[clamp(26px,6vw,44px)] font-black leading-[1.05] [font-stretch:115%]">{session.text}</h2>
      <div className={`mt-3 font-bfm text-[clamp(72px,22vw,190px)] font-bold leading-none tracking-tighter tabular-nums ${f.over ? "opacity-70" : ""}`} data-testid="focus-big-clock">
        {f.clock}
      </div>
      <div className="font-bfm text-xs opacity-75">{f.note} · the screen stays on</div>
      {subtasks.length > 0 && (
        <ul className="mt-2 flex max-w-xl flex-col gap-1.5">
          {subtasks.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  toggleSubtask(session.todoId, s.id, session.date);
                  onChanged();
                }}
                aria-pressed={s.done}
                className="flex w-full items-center gap-2.5 rounded-[10px] bg-black/10 px-3 py-2.5 text-left font-bold"
              >
                <span aria-hidden>{s.done ? "☑" : "☐"}</span>
                <span className={s.done ? "line-through opacity-60" : ""}>{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex w-full max-w-xl gap-2 pt-4">
        <button onClick={() => onStop(true)} className="flex-1 rounded-[14px] bg-bf-ontag py-3.5 text-[15px] font-extrabold text-white">
          Finish
        </button>
        <button onClick={() => onStop(false)} className="flex-1 rounded-[14px] bg-black/15 py-3.5 text-[15px] font-extrabold">
          Stop
        </button>
      </div>
    </div>
  );
}
