// The ear drill: the app plays something, you play it back. It is an ordinary DrillDef (DrillRound, weights, unlocks,
// records under drill "ear"), using the def's `sound` (what the app plays), `prompt` (the answer stays hidden behind
// "Listen") and `leadMs` (the time the sound takes is not counted as reaction time). Unlock groups:
//   1. Notes C D E F G: a reference C, then one note of the C position; play it (any octave)
//   2. Three-note phrases inside the C position, first note named; play them in order (any octave)
//   3. Major or minor: a chord on a named root (C F G D A E), struck then broken; play the chord back (major or minor
//      third decides), any octave or inversion, like the chord drill
// The hint (the answer's keys lit) shows only after a miss: lighting it on a timer would give the answer away.
import { DrillDef, DrillItem, Hint, Judgement, NoteHit } from "./pianoDrill";
import { chordPcs, chordShape, judgeChord } from "./pianoChordDrill";
import { noteName } from "./pianoMidi";

export const EAR_ID = "ear";
export const REFERENCE = 60; // C4, played before every single note
export const NOTE_GAP_MS = 700;
export const PHRASE_GAP_MS = 600;
export const CHORD_GAP_MS = 500;
export const ANSWER_MS_PER_NOTE = 400; // a phrase's extra notes take time to play back; not counted as slowness
const SETTLE_MS = 300; // the last sound has to be heard before an answer makes sense

type Base = DrillItem;
export type EarItem =
  | (Base & { kind: "note"; pitch: number })
  | (Base & { kind: "phrase"; pitches: number[] })
  | (Base & { kind: "chord"; root: number; quality: "maj" | "min" });

const C_POSITION = [60, 62, 64, 65, 67];
const PHRASES = ["C D E", "E D C", "C E G", "G E C", "D E F", "F E D", "E F G", "G F E", "C D C", "E G E"];
const LETTER: Record<string, number> = { C: 60, D: 62, E: 64, F: 65, G: 67 };
const ROOTS = [0, 5, 7, 2, 9, 4]; // C F G D A E
const ROOT_NAME = ["C", "", "D", "", "E", "F", "", "G", "", "A"];

export const EAR_ITEMS: EarItem[] = [
  ...C_POSITION.map((pitch): EarItem => ({ id: `note-${noteName(pitch)}`, group: 0, kind: "note", pitch })),
  ...PHRASES.map((p): EarItem => ({ id: `phrase-${p.replace(/ /g, "")}`, group: 1, kind: "phrase", pitches: p.split(" ").map((l) => LETTER[l]) })),
  ...ROOTS.flatMap((root) => (["maj", "min"] as const).map((quality): EarItem => ({ id: `chord-${ROOT_NAME[root]}${quality === "min" ? "m" : ""}`, group: 2, kind: "chord", root, quality }))),
];

const pc = (n: number) => ((n % 12) + 12) % 12;

export function judgeEar(item: EarItem, held: ReadonlySet<number>, hit: NoteHit, hits: readonly NoteHit[] = [hit]): Judgement {
  if (item.kind === "note") return pc(hit.note) === pc(item.pitch) ? "correct" : "miss";
  if (item.kind === "chord") return judgeChord(item, held, hit);
  const i = hits.length - 1;
  if (i >= item.pitches.length || pc(hit.note) !== pc(item.pitches[i])) return "miss";
  return i === item.pitches.length - 1 ? "correct" : "pending";
}

export function earSound(item: EarItem): { groups: number[][]; gapMs: number; velocity?: number[] } {
  if (item.kind === "note") return { groups: [[REFERENCE], [item.pitch]], gapMs: NOTE_GAP_MS, velocity: [60, 90] };
  if (item.kind === "phrase") return { groups: item.pitches.map((p) => [p]), gapMs: PHRASE_GAP_MS };
  const { notes } = chordShape(item);
  return { groups: [notes, ...notes.map((n) => [n])], gapMs: CHORD_GAP_MS };
}

export function earLeadMs(item: EarItem): number {
  const s = earSound(item);
  const extra = item.kind === "phrase" ? (item.pitches.length - 1) * ANSWER_MS_PER_NOTE : 0;
  return (s.groups.length - 1) * s.gapMs + SETTLE_MS + extra;
}

export const earLabel = (item: EarItem) =>
  item.kind === "note" ? noteName(item.pitch) : item.kind === "phrase" ? item.pitches.map(noteName).join(" ") : `${ROOT_NAME[item.root]} ${item.quality === "maj" ? "major" : "minor"}`;

export const EAR_DRILL: DrillDef<EarItem> = {
  id: EAR_ID,
  title: "Ear training",
  items: EAR_ITEMS,
  groupNames: ["Notes C D E F G", "Three-note phrases", "Major or minor"],
  label: earLabel,
  prompt: (i) => (i.kind === "chord" ? "Major or minor?" : "Listen"),
  caption: (i) =>
    i.kind === "note" ? "After the C, play the note you hear" : i.kind === "phrase" ? `Play the three notes back. It starts on ${noteName(i.pitches[0])}` : `Root ${ROOT_NAME[i.root]}: play the chord back`,
  judge: (item, held, hit, hits) => judgeEar(item, held, hit, hits),
  settle: (item, held) => {
    if (item.kind !== "chord") return false;
    const want = chordPcs(item);
    const have = new Set([...held].map(pc));
    return have.size === want.size && [...want].every((p) => have.has(p));
  },
  hint: (item): Hint => {
    if (item.kind === "note") return { lit: new Set([item.pitch]) };
    if (item.kind === "phrase") {
      const fingers: Record<number, number> = {};
      for (const p of item.pitches) fingers[p] = C_POSITION.indexOf(p) + 1;
      return { lit: new Set(item.pitches), fingers };
    }
    const { notes, fingers } = chordShape(item);
    return { lit: new Set(notes), fingers };
  },
  sound: earSound,
  leadMs: earLeadMs,
  hintAfterMs: Infinity,
};
