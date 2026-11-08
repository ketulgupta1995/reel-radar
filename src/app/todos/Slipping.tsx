"use client";

import { useState } from "react";
import { SLIPPING_AFTER, postponeCount, type Todo } from "@/lib/todos";

// Shown on a task that keeps getting pushed back: stop carrying it, or make it smaller.
export function SlippingHint({ todo, onDrop, onAddStep }: { todo: Todo; onDrop: () => void; onAddStep: (text: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState("");
  if (todo.completed || postponeCount(todo) < SLIPPING_AFTER) return null;

  const addStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!step.trim()) return;
    onAddStep(step.trim());
    setStep("");
  };

  return (
    <div className={`mt-2 rounded-lg px-3 py-2 text-xs bg-gold font-semibold text-bf-ontag`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 basis-40">Postponed {postponeCount(todo)} times. Drop it or break it down?</span>
        <button onClick={onDrop} className="font-bold underline">
          Drop it
        </button>
        <button onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="font-bold underline">
          Break it down
        </button>
      </div>
      {adding && (
        <>
          {!!todo.subtasks?.length && (
            <ul className="mt-2 space-y-0.5">
              {todo.subtasks.map((s) => (
                <li key={s.id} className="break-words">
                  · {s.text}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addStep} className="mt-2 flex gap-2">
            <input
              value={step}
              onChange={(e) => setStep(e.target.value)}
              placeholder="A smaller first step"
              aria-label={`A smaller step for “${todo.text}”`}
              className="min-w-0 flex-1 rounded-lg bg-white/70 px-2 py-1 text-bf-ontag placeholder:text-bf-ontag/60 focus:outline-none"
            />
            <button type="submit" className="rounded-full bg-bf-ontag px-3 py-1 font-bold text-white">
              Add step
            </button>
          </form>
        </>
      )}
    </div>
  );
}
