// Song ladders (pure). The tempo ladder: a song's play-along tempo starts at ~60% of its BPM and goes up
// 5 BPM after a run with at least 90% of the notes on time, up to the song's own BPM. The hands ladder:
// right hand (wait) -> left hand (wait) -> both hands (wait) -> both hands at tempo; the app suggests the
// next step when the current one went well. Progress per song lives in piano-settings (pianoData).
import { MIN_BPM } from "./pianoTiming";
import { HandChoice, Song } from "./pianoSongs";

export type SongMode = "wait" | "play";
export type LadderStep = { hands: HandChoice; mode: SongMode; label: string };
export const HANDS_LADDER: readonly LadderStep[] = [
  { hands: "R", mode: "wait", label: "Right hand, wait" },
  { hands: "L", mode: "wait", label: "Left hand, wait" },
  { hands: "both", mode: "wait", label: "Both hands, wait" },
  { hands: "both", mode: "play", label: "Both hands at tempo" },
];
export const LAST_STEP = HANDS_LADDER.length - 1;

export const GOOD_ON_TIME = 0.9; // share of notes on time that counts as a good play-along run
export const TEMPO_STEP = 5;
export const START_FRACTION = 0.6;
const round5 = (n: number) => Math.round(n / 5) * 5;

export type SongProgress = {
  step: number; // 0-3: the hands-ladder step to work on (never goes back)
  tempo: number; // the tempo ladder: BPM of the next play-along run
  best: number; // best on-time % of a play-along run (0-100)
  mastered?: boolean; // a play-along run with both hands at the song's full BPM was good
  at: number; // when it last changed
};

export const startTempo = (bpm: number) => Math.min(bpm, Math.max(MIN_BPM, round5(bpm * START_FRACTION)));
export const ladderTempo = (song: Pick<Song, "bpm">, p?: SongProgress) => Math.min(song.bpm, p?.tempo ?? startTempo(song.bpm));
export const nextTempo = (tempo: number, bpm: number, onTime: number) => (onTime >= GOOD_ON_TIME ? Math.min(bpm, tempo + TEMPO_STEP) : tempo);

// Wait steps count as done when the song was finished with at most 2 misses or 10% of its steps.
export const waitDoneWell = (misses: number, steps: number) => misses <= Math.max(2, Math.floor(steps * 0.1));

export const stepIndex = (hands: HandChoice, mode: SongMode) => HANDS_LADDER.findIndex((s) => s.hands === hands && s.mode === mode);

export type RunResult =
  | { mode: "wait"; hands: HandChoice; finished: boolean; misses: number; steps: number }
  | { mode: "play"; hands: HandChoice; onTime: number; tempo: number }; // onTime 0-1, tempo = BPM of the run

export type RunOutcome = { progress: SongProgress; changed: boolean; stepDone: boolean; mastered: boolean; nextTempo: number | null };

// Applies one finished run to a song's progress. `changed` is false when nothing moved (no write needed).
export function applyRun(song: Pick<Song, "bpm">, prev: SongProgress | undefined, run: RunResult, now: number): RunOutcome {
  const base: SongProgress = prev ?? { step: 0, tempo: startTempo(song.bpm), best: 0, at: 0 };
  const p = { ...base };
  const j = stepIndex(run.hands, run.mode);
  let stepDone = false;
  let next: number | null = null;
  if (run.mode === "wait") {
    if (run.finished && waitDoneWell(run.misses, run.steps) && j >= 0 && j < LAST_STEP) {
      stepDone = true;
      p.step = Math.max(p.step, j + 1);
    }
  } else {
    const good = run.onTime >= GOOD_ON_TIME;
    next = nextTempo(run.tempo, song.bpm, run.onTime);
    p.tempo = Math.max(p.tempo, next);
    p.best = Math.max(p.best, Math.round(run.onTime * 100));
    if (good && j === LAST_STEP && run.tempo >= song.bpm) {
      stepDone = true;
      p.mastered = true;
    }
  }
  const changed = p.step !== base.step || p.tempo !== base.tempo || p.best !== base.best || !!p.mastered !== !!base.mastered;
  if (changed) p.at = now;
  return { progress: p, changed, stepDone, mastered: !!p.mastered, nextTempo: next };
}

// Merge rule for two copies of a song's progress: nothing goes backwards.
export const mergeProgress = (a?: SongProgress, b?: SongProgress): SongProgress | undefined => {
  if (!a || !b) return a ?? b;
  const mastered = a.mastered || b.mastered;
  return { step: Math.max(a.step, b.step), tempo: Math.max(a.tempo, b.tempo), best: Math.max(a.best, b.best), ...(mastered ? { mastered: true } : {}), at: Math.max(a.at, b.at) };
};

// One line for the songs list.
export function progressLine(p?: SongProgress): string {
  if (!p) return "";
  if (p.mastered) return `Mastered · best ${p.best}%`;
  return `Step ${p.step + 1} of ${HANDS_LADDER.length}: ${HANDS_LADDER[p.step].label}${p.best ? ` · best ${p.best}%` : ""}`;
}
