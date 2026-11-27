"use client";

import { useCallback, useEffect, useState } from "react";
import { loadSettings, recentRecords } from "@/lib/pianoData";
import { canSwap, plan } from "@/lib/pianoSession";
import { SessionState, isDone, loadToday, newState, saveToday, startLabel } from "@/lib/pianoSessionState";
import { unlockAudio } from "@/lib/pianoSynth";

const PLAN_DAYS = 30; // history the planner reads

// Today's session: null until read after the first render (so the first render matches the server). When there is no
// state for today the plan is computed and saved. `update` applies a change and saves it; `again` plans afresh.
export function useTodaySession() {
  const [state, setState] = useState<SessionState | null>(null);
  const fresh = useCallback(() => {
    const now = Date.now();
    const s = newState(plan(recentRecords(now, PLAN_DAYS), loadSettings(), now), now);
    saveToday(s);
    return s;
  }, []);
  useEffect(() => setState(loadToday(Date.now()) ?? fresh()), [fresh]);
  const update = useCallback((fn: (s: SessionState) => SessionState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveToday(next);
      return next;
    });
  }, []);
  const again = useCallback(() => setState(fresh()), [fresh]);
  return { state, update, again };
}

const mins = (n: number) => `${n} min`;

// The three planned steps with Swap buttons and the Start / Resume button. `onStart` runs inside the tap, after the
// audio has been unlocked. `onSwap` gets the new state (the page saves it through `update`).
//   <TodayCard state={state} onSwap={(i) => update((s) => withSwap(s, swap(s.plan, i)))} onStart={...} />
export function TodayCard({ state, onSwap, onStart }: { state: SessionState; onSwap: (i: 0 | 1 | 2) => void; onStart: () => void }) {
  const { plan: p } = state;
  return (
    <section aria-label="Today's practice" className="space-y-4 rounded-xl border border-pn-line bg-pn-felt p-4">
      <h2 className="font-pnd text-2xl font-semibold">Today&apos;s practice</h2>
      <ol className="m-0 list-none divide-y divide-pn-line border-y border-pn-line p-0">
        {p.steps.map((s, i) => {
          const done = i < state.index;
          return (
            <li key={`${i}-${s.label}`} data-testid="plan-step" data-done={done} className="flex items-center gap-3 py-3">
              <span className="w-6 shrink-0 font-pnd text-xl text-pn-brass">{done ? "✓" : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{s.label}</span>
                <span className="block text-sm text-pn-ivory/60">{s.why}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-pn-ivory/70">{mins(s.target.minutes)}</span>
              <button
                type="button"
                aria-label={`Swap step ${i + 1}`}
                disabled={done || !canSwap(p, i as 0 | 1 | 2)}
                onClick={() => onSwap(i as 0 | 1 | 2)}
                className="min-h-11 shrink-0 rounded-full border border-pn-ivory/25 px-3 text-sm text-pn-ivory/80 hover:bg-pn-ivory/10 disabled:opacity-30"
              >
                Swap
              </button>
            </li>
          );
        })}
      </ol>
      {!isDone(state) && (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            onStart();
          }}
          className="rounded-full bg-pn-brass px-8 py-3 font-semibold text-pn-ebony hover:brightness-110"
        >
          {startLabel(state)}
        </button>
      )}
    </section>
  );
}
