// The chord drill: a chord name is shown; it is right when the held pitch classes equal the chord's
// (any octave, inversion or doubling). Unlock groups:
//   1. C F G
//   2. Am Dm Em
//   3. every other major (D A E B B♭ E♭ A♭ D♭ F#) and minor (Bm Gm Cm Fm F#m C#m G#m B♭m E♭m)
//   4. dominant 7ths: C7 G7 D7 A7 E7 F7 B♭7 B7
// Names use conventional spelling (flat keys B♭ E♭ A♭ D♭, sharp keys F# C#m F#m G#m), except B♭m/E♭m.
import { DrillDef, DrillItem, Hint } from "./pianoDrill";

export type Quality = "maj" | "min" | "dom7";
export type ChordItem = DrillItem & { root: number; quality: Quality };

const INTERVALS: Record<Quality, number[]> = { maj: [0, 4, 7], min: [0, 3, 7], dom7: [0, 4, 7, 10] };
// Standard right-hand root-position fingering: thumb, middle, little; sevenths 1-2-3-5.
const FINGERS: Record<Quality, number[]> = { maj: [1, 3, 5], min: [1, 3, 5], dom7: [1, 2, 3, 5] };
const SUFFIX: Record<Quality, string> = { maj: "", min: "m", dom7: "7" };
const ROOT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F#", "G", "A♭", "A", "B♭", "B"];
const MINOR_ROOT_NAMES = ["C", "C#", "D", "E♭", "E", "F", "F#", "G", "G#", "A", "B♭", "B"];

export const chordName = (root: number, quality: Quality) => (quality === "min" ? MINOR_ROOT_NAMES : ROOT_NAMES)[root] + SUFFIX[quality];

const GROUPS: [number, Quality][][] = [
  [[0, "maj"], [5, "maj"], [7, "maj"]],
  [[9, "min"], [2, "min"], [4, "min"]],
  [
    ...([2, 9, 4, 11, 10, 3, 8, 1, 6] as const).map((r): [number, Quality] => [r, "maj"]),
    ...([11, 7, 0, 5, 6, 1, 8, 10, 3] as const).map((r): [number, Quality] => [r, "min"]),
  ],
  [[0, "dom7"], [7, "dom7"], [2, "dom7"], [9, "dom7"], [4, "dom7"], [5, "dom7"], [10, "dom7"], [11, "dom7"]],
];

export const chordPcs = (c: { root: number; quality: Quality }) => new Set(INTERVALS[c.quality].map((i) => (c.root + i) % 12));

// Root position above middle C (root in 60..71), with its finger numbers.
export function chordShape(c: { root: number; quality: Quality }): { notes: number[]; fingers: Record<number, number> } {
  const notes = INTERVALS[c.quality].map((i) => 60 + c.root + i);
  const fingers: Record<number, number> = {};
  notes.forEach((n, k) => (fingers[n] = FINGERS[c.quality][k]));
  return { notes, fingers };
}

const pc = (n: number) => ((n % 12) + 12) % 12;

// Only the newly pressed note can be a miss (keys left down from the last chord don't count); the chord
// is complete when the held set is exactly its pitch classes, so stale extra keys keep it pending until released.
export function judgeChord(c: { root: number; quality: Quality }, held: ReadonlySet<number>, hit: { note: number }) {
  const want = chordPcs(c);
  if (!want.has(pc(hit.note))) return "miss" as const;
  const have = new Set([...held].map(pc));
  return have.size === want.size && [...want].every((p) => have.has(p)) ? ("correct" as const) : ("pending" as const);
}

export const CHORD_DRILL: DrillDef<ChordItem> = {
  id: "chords",
  title: "Chord drill",
  items: GROUPS.flatMap((g, group) =>
    g.map(([root, quality]) => {
      const label = chordName(root, quality);
      return { id: label.replace(/♭/g, "b"), root, quality, group };
    }),
  ),
  groupNames: GROUPS.map((g) => g.map(([r, q]) => chordName(r, q)).join(" ")),
  label: (i) => chordName(i.root, i.quality),
  judge: (item, held, hit) => judgeChord(item, held, hit),
  // C to Am: C and E stay down, A is added, then G is lifted. The lift completes the chord.
  settle: (item, held) => {
    const want = chordPcs(item);
    const have = new Set([...held].map(pc));
    return have.size === want.size && [...want].every((p) => have.has(p));
  },
  hint: (item): Hint => {
    const { notes, fingers } = chordShape(item);
    return { lit: new Set(notes), fingers };
  },
};
