"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { recentRecords, recentSessions } from "@/lib/pianoData";
import { STREAK_MIN_MS, minutesOf, streak, todayMs } from "@/lib/pianoLog";
import { todayNoteSpeed } from "@/lib/pianoNoteSpeed";
import { swap } from "@/lib/pianoSession";
import { SessionState, completeStep, isDone, withSwap } from "@/lib/pianoSessionState";
import { Results } from "../Results";
import { StepRunner } from "./StepRunner";
import { TodayCard, useTodaySession } from "./TodayCard";

// Today's practice: the plan with Swap and Start (or Resume) on a plain page (the home's Start opens it already running); each step then runs on its own stage and
// the session ends on the combined results. State lives in localStorage for the day (lib/pianoSessionState.ts).
export default function PracticePage() {
  const { state, update, again } = useTodaySession();
  const [running, setRunning] = useState(false);
  const router = useRouter();
  // null until read; true while the home's ?start=1 is still to be acted on (the card stays hidden meanwhile).
  const [auto, setAuto] = useState<boolean | null>(null);

  // The home's Start tap arrives as ?start=1: run the step at once (no second tap), then clear the flag so a reload
  // shows the card again. Read from the address in an effect, so the first render matches the server's; the day's
  // state also loads in an effect, so starting waits for both (and repeats harmlessly under StrictMode).
  useEffect(() => setAuto(new URLSearchParams(window.location.search).has("start")), []);
  useEffect(() => {
    if (!state || !auto) return;
    setAuto(false);
    router.replace("/piano/practice");
    if (isDone(state)) return;
    update((s) => ({ ...s, started: true }));
    setRunning(true);
  }, [state, auto, update, router]);

  if (!state || auto === null || (auto && !isDone(state))) return <Shell />;
  if (isDone(state)) return <Shell><Done state={state} again={() => { again(); setRunning(false); }} /></Shell>;
  if (running) {
    const step = state.plan.steps[state.index];
    const names = state.plan.steps.map((s) => ({ label: s.label, minutes: s.target.minutes }));
    return <StepRunner key={state.index} step={step} steps={names} index={state.index} onDone={(card) => update((s) => completeStep(s, card))} />;
  }
  return (
    <Shell>
      <TodayCard
        state={state}
        onSwap={(i) => update((s) => withSwap(s, swap(s.plan, i)))}
        onStart={() => {
          update((s) => ({ ...s, started: true }));
          setRunning(true);
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <Link href="/piano" className="text-sm text-pn-ivory/70 hover:text-pn-brass">
        ← Piano
      </Link>
      {children}
    </div>
  );
}

function Done({ state, again }: { state: SessionState; again: () => void }) {
  const now = Date.now();
  const min = minutesOf(todayMs(recentRecords(now, 400), now));
  const days = streak(recentRecords(now, 400), now);
  const counts = todayMs(recentRecords(now, 400), now) >= STREAK_MIN_MS;
  return (
    <div className="space-y-3">
      <Results
        title="Practice done"
        cards={state.cards}
        noteSpeed={todayNoteSpeed(recentSessions(now, 2), now)}
        primary={{ label: "Done", href: "/piano" }}
        secondary={{ label: "Keep going: free practice", href: "/piano/play" }}
      />
      <p data-testid="today-line" className="text-sm text-pn-ivory/80">
        Today {min} min{counts ? ", counts for the streak" : ` of ${minutesOf(STREAK_MIN_MS)}`}. Streak {days} {days === 1 ? "day" : "days"}.
      </p>
      <button type="button" onClick={again} className="rounded-full border border-pn-ivory/30 px-5 py-2.5 text-sm hover:bg-pn-ivory/10">
        Practise again
      </button>
    </div>
  );
}
