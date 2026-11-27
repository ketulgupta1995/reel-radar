// Rule-based fingering suggester for imported songs (pure). It only guesses a sensible starting point;
// imported songs show it as "suggested". One hand at a time; no thumb-under or crossing.
//
//  - Notes that start together are a chord, fingered by size, lowest note first:
//      2 notes: a wide interval (5 semitones or more) uses 1-5, a close one 1-3
//      3 notes: 1-3-5, 4 notes: 1-2-3-5, 5 notes or more: 1-2-3-4-5 (extra notes get 5)
//    The left hand mirrors it (5-3-1: the little finger takes the lowest note). A chord drops the hand position.
//  - Single notes follow five-finger positions. A position spans 7 semitones from its anchor (the lowest note
//    for the right hand, the highest for the left). Finger = FINGER_AT[distance from the anchor], so the
//    thumb sits on the anchor and 5 on the note a fifth away. When a note falls outside the position, a new one
//    is chosen from the notes that follow: it covers as many of the next notes as fit in the span.
import { Hand } from "./pianoSongs";

export const POSITION_SPAN = 7;
export const FINGER_AT = [1, 2, 2, 3, 3, 4, 4, 5]; // semitones from the anchor (0-7) -> finger
const LOOKAHEAD = 12; // notes looked at when choosing a position

const CHORD: Record<number, number[]> = { 2: [1, 5], 3: [1, 3, 5], 4: [1, 2, 3, 5], 5: [1, 2, 3, 4, 5] };
function chordFingers(pitches: number[], hand: Hand): number[] {
  const n = pitches.length; // ascending
  const up = n === 2 ? (pitches[1] - pitches[0] >= 5 ? [1, 5] : [1, 3]) : (CHORD[Math.min(n, 5)] ?? []).concat(Array(Math.max(0, n - 5)).fill(5));
  return hand === "R" ? up : [...up].reverse();
}

// Fingers for `notes` (any order), returned in the same order.
export function suggestFingering(notes: readonly { start: number; pitch: number }[], hand: Hand): number[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start || notes[a].pitch - notes[b].pitch);
  const out: number[] = new Array(notes.length).fill(1);
  const steps: number[][] = []; // indexes into notes, one array per start beat
  for (const i of order) {
    const last = steps[steps.length - 1];
    if (last && notes[last[0]].start === notes[i].start) last.push(i);
    else steps.push([i]);
  }
  const single = (s: number) => steps[s].length === 1;
  // Distance from the anchor in the hand's playing direction: up for the right hand, down for the left.
  const dist = (anchor: number, pitch: number) => (hand === "R" ? pitch - anchor : anchor - pitch);

  let anchor: number | null = null;
  for (let s = 0; s < steps.length; s++) {
    const idx = steps[s];
    if (!single(s)) {
      const fingers = chordFingers(idx.map((i) => notes[i].pitch), hand);
      idx.forEach((i, k) => (out[i] = fingers[k]));
      anchor = null;
      continue;
    }
    const pitch = notes[idx[0]].pitch;
    if (anchor === null || dist(anchor, pitch) < 0 || dist(anchor, pitch) > POSITION_SPAN) {
      let lo = pitch;
      let hi = pitch;
      for (let t = s + 1; t < steps.length && t < s + LOOKAHEAD && single(t); t++) {
        const p = notes[steps[t][0]].pitch;
        if (Math.max(hi, p) - Math.min(lo, p) > POSITION_SPAN) break;
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
      anchor = hand === "R" ? lo : hi;
    }
    out[idx[0]] = FINGER_AT[dist(anchor, pitch)];
  }
  return out;
}
