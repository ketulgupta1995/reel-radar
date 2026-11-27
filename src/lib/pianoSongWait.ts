// Wait mode (pure): the song stays on a step until every key the player's hand(s) should press is held.
// The hand the player isn't playing is played by the app when its step is reached. Ticket 10 (play-along)
// and 11 (hands ladder) reuse stepsOf/handOf from pianoSongs; this is only the wait-mode state machine.
import { HandChoice, Song, SongNote, Step, beatMs, handOf, stepsOf } from "./pianoSongs";

export type WaitState = {
  song: Song;
  steps: Step[];
  hands: HandChoice;
  index: number; // current step; === steps.length when the song is over
  misses: number;
  done: boolean;
};

export function startWait(song: Song, hands: HandChoice): WaitState {
  const steps = stepsOf(song);
  return { song, steps, hands, index: 0, misses: 0, done: steps.length === 0 };
}

const current = (s: WaitState) => (s.done ? undefined : s.steps[s.index]);
// Notes the player has to press on this step.
export const expectedNotes = (s: WaitState): SongNote[] => handOf(current(s)?.notes ?? [], s.hands);
export const expectedPitches = (s: WaitState) => expectedNotes(s).map((n) => n.pitch);
// Notes the app plays when this step is reached (the other hand).
export const autoNotes = (s: WaitState): SongNote[] => {
  const mine = new Set(expectedNotes(s));
  return (current(s)?.notes ?? []).filter((n) => !mine.has(n));
};

export type PressResult = "ignored" | "miss" | "hit" | "advance" | "done";

// Call on every note-on, with the held keys including that note. Only a note-on can complete a step
// (a key still held from the last step doesn't count by itself). A key that isn't expected is a miss and
// doesn't move the song. A step with nothing to press (the app's hand only) ignores the keyboard.
export function press(s: WaitState, note: number, held: ReadonlySet<number>): { state: WaitState; result: PressResult } {
  const want = expectedPitches(s);
  if (s.done || !want.length) return { state: s, result: "ignored" };
  if (!want.includes(note)) return { state: { ...s, misses: s.misses + 1 }, result: "miss" };
  if (!want.every((p) => held.has(p))) return { state: s, result: "hit" };
  const next = advance(s);
  return { state: next, result: next.done ? "done" : "advance" };
}

// Move to the next step (after a completed step, or when the app's hand has finished a step on its own).
export function advance(s: WaitState): WaitState {
  if (s.done) return s;
  const index = s.index + 1;
  return { ...s, index, done: index >= s.steps.length };
}

// How long the app's hand takes on the current step: until the next step starts (or the longest note ends
// on the last step), at the song's tempo times the speed (0.25 to 1).
export function stepDelayMs(s: WaitState, speed: number): number {
  const step = current(s);
  if (!step) return 0;
  const next = s.steps[s.index + 1];
  const beats = next ? next.start - step.start : Math.max(...step.notes.map((n) => n.dur));
  return beats * beatMs(s.song.bpm, speed);
}

export const stepsPlayed = (s: WaitState) => Math.min(s.index, s.steps.length);
