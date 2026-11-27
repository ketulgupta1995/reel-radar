// Today's practice session state (pure helpers + localStorage): the plan with any swaps, the current step, the result
// cards collected so far. One key per local day, `reel-radar-piano-session-YYYY-MM-DD`; not synced (not in DOC_KEY).
// Writing today's key removes every older day's key.
import type { ResultCard } from "@/app/piano/Results";
import { dayKey } from "./pianoLog";
import { Plan, StepId } from "./pianoSession";

export const SESSION_PREFIX = "reel-radar-piano-session-";
export const STEPS = 3;

export type SessionState = {
  day: string; // local day, YYYY-MM-DD
  plan: Plan;
  started: boolean; // Start practice was tapped
  index: number; // current step 0-2; 3 = all done
  finished: StepId[]; // ids of finished steps
  cards: ResultCard[]; // one per finished step, in order
};

export const sessionKey = (day: string) => SESSION_PREFIX + day;
export const newState = (plan: Plan, now: number): SessionState => ({ day: dayKey(new Date(now)), plan, started: false, index: 0, finished: [], cards: [] });
export const isDone = (s: SessionState) => s.index >= STEPS;
// The start button's text: Start, or Resume with the step the learner is on.
export const startLabel = (s: SessionState) => (s.started ? `Resume: step ${Math.min(s.index + 1, STEPS)} of ${STEPS}` : "Start practice");
export const withSwap = (s: SessionState, plan: Plan): SessionState => ({ ...s, plan });
// A step ended with its card: record it and move on.
export const completeStep = (s: SessionState, card: ResultCard): SessionState => ({
  ...s,
  started: true,
  index: s.index + 1,
  finished: [...s.finished, s.plan.steps[s.index].id],
  cards: [...s.cards, card],
});

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// A stored value is used only when it has the shape written here; anything else counts as no session.
function valid(v: unknown, day: string): v is SessionState {
  if (!plain(v) || v.day !== day || typeof v.started !== "boolean") return false;
  if (typeof v.index !== "number" || !Number.isInteger(v.index) || v.index < 0 || v.index > STEPS) return false;
  if (!Array.isArray(v.finished) || !Array.isArray(v.cards) || v.cards.length !== v.index || v.finished.length !== v.index) return false;
  const p = v.plan;
  return plain(p) && Array.isArray(p.steps) && p.steps.length === STEPS && Array.isArray(p.alternates) && p.alternates.length === STEPS && p.steps.every((s) => plain(s) && plain(s.target));
}

export function loadToday(now: number): SessionState | null {
  const day = dayKey(new Date(now));
  try {
    const raw = localStorage.getItem(sessionKey(day));
    const v: unknown = raw ? JSON.parse(raw) : null;
    return valid(v, day) ? v : null;
  } catch {
    return null;
  }
}

export function saveToday(s: SessionState) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SESSION_PREFIX) && k !== sessionKey(s.day)) localStorage.removeItem(k);
    }
    localStorage.setItem(sessionKey(s.day), JSON.stringify(s));
  } catch {
    // Storage full or blocked: the session still runs, it just won't resume.
  }
}
