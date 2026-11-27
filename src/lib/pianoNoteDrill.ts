// The note drill: a note name is shown, any octave of it is right. Sharps, never flats.
// Unlock groups (each opens once the groups before it are 90% right and quick enough):
// C D E, then F G, then A B, then the five sharps.
import { DrillDef, DrillItem } from "./pianoDrill";
import { noteName } from "./pianoMidi";

export type NoteItem = DrillItem & { pc: number };

const GROUPS: number[][] = [[0, 2, 4], [5, 7], [9, 11], [1, 3, 6, 8, 10]];
const NAMES = GROUPS.map((g) => g.map((pc) => noteName(pc)).join(" "));

export const NOTE_DRILL: DrillDef<NoteItem> = {
  id: "notes",
  title: "Note drill",
  items: GROUPS.flatMap((g, group) => g.map((pc) => ({ id: noteName(pc), pc, group }))),
  groupNames: NAMES,
  label: (i) => i.id,
  judge: (item, _held, hit) => (((hit.note % 12) + 12) % 12 === item.pc ? "correct" : "miss"),
  hint: (item, { low, high }) => {
    const lit = new Set<number>();
    for (let n = low; n <= high; n++) if (n % 12 === item.pc) lit.add(n);
    return { lit };
  },
};
