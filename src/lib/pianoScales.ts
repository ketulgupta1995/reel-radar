// Piano's scales (pure): one octave up and down, right and left hand, for C, G, F, D and A major and A minor.
// A scale is built as a Song (quarter notes, the last note a half note so the four bars fill) so the song
// player gives it wait mode, play-along, falling notes with fingers and the ladders.
//   - A minor is the NATURAL minor (no raised seventh): the white keys, the simplest one for a beginner.
//   - The right hand starts on the tonic in octave 4 and the left hand on the same note in octave 3.
//   - Standard fingering (the hand goes up, then down from the top note, which is played once):
//       right hand C G D A major and A minor: 1 2 3 1 2 3 4 5, down 4 3 2 1 3 2 1; F major: 1 2 3 4 1 2 3 4, down 3 2 1 4 3 2 1
//       left hand (all six): 5 4 3 2 1 3 2 1, down 2 3 1 2 3 4 5
//   - Crossings: a note reached by the thumb passing under (finger 3 or 4 to 1) is marked "under"; a note reached
//     by a finger crossing over the thumb (1 to 3 or 4) is marked "over". The mark is on the note after the crossing.
import { Hand, Song, SongNote } from "./pianoSongs";

export type Scale = { id: string; name: string; key: string; tonic: number; minor: boolean }; // tonic: MIDI note, right hand's octave
export const SCALES: readonly Scale[] = [
  { id: "scale-c-major", name: "C major", key: "C", tonic: 60, minor: false },
  { id: "scale-g-major", name: "G major", key: "G", tonic: 67, minor: false },
  { id: "scale-f-major", name: "F major", key: "F", tonic: 65, minor: false },
  { id: "scale-d-major", name: "D major", key: "D", tonic: 62, minor: false },
  { id: "scale-a-major", name: "A major", key: "A", tonic: 69, minor: false },
  { id: "scale-a-minor", name: "A minor", key: "A minor", tonic: 69, minor: true },
]; // also the unlock order: each scale opens once the one before it has its right hand done
export const scaleById = (id: string) => SCALES.find((s) => s.id === id);

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];

type Fingering = { up: number[]; down: number[] }; // up: 8 notes; down: the 7 after the top note
const STANDARD: Record<Hand, Fingering> = {
  R: { up: [1, 2, 3, 1, 2, 3, 4, 5], down: [4, 3, 2, 1, 3, 2, 1] },
  L: { up: [5, 4, 3, 2, 1, 3, 2, 1], down: [2, 3, 1, 2, 3, 4, 5] },
};
const F_MAJOR_R: Fingering = { up: [1, 2, 3, 4, 1, 2, 3, 4], down: [3, 2, 1, 4, 3, 2, 1] };
export const fingeringOf = (scale: Scale, hand: Hand): Fingering => (scale.id === "scale-f-major" && hand === "R" ? F_MAJOR_R : STANDARD[hand]);

export type ScaleNote = { pitch: number; finger: number; cross?: "under" | "over" };
export const CROSS_LABEL = { under: "thumb under", over: "finger over" } as const;

// The 15 notes of one hand: the octave up, then back down to the tonic.
export function scaleNotes(scale: Scale, hand: Hand): ScaleNote[] {
  const steps = scale.minor ? MINOR : MAJOR;
  const root = scale.tonic - (hand === "L" ? 12 : 0);
  const pitches = [...steps, ...steps.slice(0, -1).reverse()].map((s) => root + s);
  const f = fingeringOf(scale, hand);
  const fingers = [...f.up, ...f.down];
  return pitches.map((pitch, i) => {
    const prev = fingers[i - 1];
    const cross = i === 0 ? undefined : fingers[i] === 1 && prev >= 3 ? "under" : prev === 1 && fingers[i] >= 3 ? "over" : undefined;
    return { pitch, finger: fingers[i], ...(cross ? { cross } : {}) };
  });
}

export const SCALE_BPM = 80;
export function scaleSong(scale: Scale): Song {
  const notes: SongNote[] = [];
  for (const hand of ["R", "L"] as const) {
    scaleNotes(scale, hand).forEach((n, i, all) => notes.push({ start: i, dur: i === all.length - 1 ? 2 : 1, pitch: n.pitch, hand, finger: n.finger, ...(n.cross ? { cross: n.cross } : {}) }));
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { id: scale.id, title: `${scale.name} scale`, bpm: SCALE_BPM, beatsPerBar: 4, level: 1, key: scale.key, notes };
}
export const SCALE_SONGS: Song[] = SCALES.map(scaleSong);
export const scaleSongById = (id: string) => SCALE_SONGS.find((s) => s.id === id);

export const BOTH_UNLOCK_PCT = 90; // a one-hand play-along run this good opens both hands
// Unlocks (pure; progress is a song's progress in piano-settings): a scale opens when the one before it has its
// right hand done (hands ladder step 1 or more); both hands open after a play-along run of at least 90% on time.
export function scaleUnlocked(index: number, progressOf: (id: string) => { step: number } | undefined): boolean {
  return index <= 0 || (progressOf(SCALES[index - 1].id)?.step ?? 0) >= 1;
}
export const bothUnlocked = (p?: { best: number }) => (p?.best ?? 0) >= BOTH_UNLOCK_PCT;
