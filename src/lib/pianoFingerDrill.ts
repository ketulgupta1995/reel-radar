// The five-finger drill: a hand position is shown (its five keys, with finger numbers, stay on the
// keyboard all round) and a finger is called; only that finger's exact key is right.
// A position is the major five-finger pattern from its tonic (tonic + 0 2 4 5 7), so D has F#, A has C#,
// E has G# and F has B♭ with no special cases. Right hand: thumb (1) on the tonic at octave 4 (C4 = 60).
// Left hand: little finger (5) on the tonic at octave 3 (C3 = 48), thumb on the highest key.
// Unlock groups: 1. right C G F  2. left C G F  3. right and left D A E  4. right and left B♭ E♭ A♭ B.
// The hint (after a miss or 2 s) lights only the called key; finger numbers show on all five keys always.
import { DrillDef, DrillItem } from "./pianoDrill";

export type Hand = "RH" | "LH";
export type Position = { id: string; hand: Hand; tonic: number; name: string; group: number };
export type FingerItem = DrillItem & { position: Position; finger: number };

const OFFSETS = [0, 2, 4, 5, 7];
const NAMES: Record<number, string> = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 3: "E♭", 8: "A♭", 10: "B♭", 11: "B" };
const ID: Record<number, string> = { 0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 3: "Eb", 8: "Ab", 10: "Bb", 11: "B" };

const SETS: { hands: Hand[]; pcs: number[] }[] = [
  { hands: ["RH"], pcs: [0, 7, 5] },
  { hands: ["LH"], pcs: [0, 7, 5] },
  { hands: ["RH", "LH"], pcs: [2, 9, 4] },
  { hands: ["RH", "LH"], pcs: [10, 3, 8, 11] },
];

export const POSITIONS: Position[] = SETS.flatMap((s, group) =>
  s.hands.flatMap((hand) => s.pcs.map((pc) => ({ id: `${hand}-${ID[pc]}`, hand, tonic: (hand === "RH" ? 60 : 48) + pc, name: NAMES[pc], group }))),
);

// The key a finger (1 = thumb .. 5 = little) plays in a position.
export const fingerKey = (p: Position, finger: number) => p.tonic + OFFSETS[p.hand === "RH" ? finger - 1 : 5 - finger];
// All five keys of a position, as note -> finger.
export function positionFingers(p: Position): Record<number, number> {
  const out: Record<number, number> = {};
  for (let f = 1; f <= 5; f++) out[fingerKey(p, f)] = f;
  return out;
}
export const positionText = (p: Position) => `${p.hand === "RH" ? "Right" : "Left"} hand · ${p.name} position`;

export const FINGER_DRILL: DrillDef<FingerItem> = {
  id: "fingers",
  title: "Five-finger positions",
  items: POSITIONS.flatMap((position) => [1, 2, 3, 4, 5].map((finger) => ({ id: `${position.id}-${finger}`, group: position.group, position, finger }))),
  groupNames: SETS.map((s) => `${s.hands.map((h) => (h === "RH" ? "Right" : "Left")).join(" and ")} hand: ${s.pcs.map((pc) => NAMES[pc]).join(" ")}`),
  label: (i) => String(i.finger),
  caption: (i) => positionText(i.position),
  setup: (i) => positionFingers(i.position),
  judge: (item, _held, hit) => (hit.note === fingerKey(item.position, item.finger) ? "correct" : "miss"),
  hint: (item) => ({ lit: new Set([fingerKey(item.position, item.finger)]), fingers: positionFingers(item.position) }),
  fingerOf: (item, note) => positionFingers(item.position)[note],
};
