import { isBlack } from "./pianoMidi";

// The key range the stage draws for an item: its notes padded out to whole octaves (C up to a C), never
// narrower than C3-C5, and within the 88 keys. A white key wants 44 px in landscape; in portrait the
// keyboard keeps its 28 px minimum. When the range won't fit the width at that size, `scrolls` is true
// and the keyboard scrolls sideways, as it always has.
export const MIN_KEY_LANDSCAPE = 44;
export const MIN_KEY_PORTRAIT = 28;
const FLOOR = { low: 48, high: 72 }; // C3 to C5
const PIANO = { low: 21, high: 108 }; // A0 to C8

export type KeyboardRange = { low: number; high: number; whites: number; minKey: number; scrolls: boolean };

export function keyboardRange(notes: readonly number[], view: { width: number; landscape: boolean }): KeyboardRange {
  let low: number = FLOOR.low;
  let high: number = FLOOR.high;
  if (notes.length > 0) {
    low = Math.min(low, Math.floor(Math.min(...notes) / 12) * 12);
    high = Math.max(high, Math.ceil(Math.max(...notes) / 12) * 12);
  }
  low = Math.max(low, Math.ceil(PIANO.low / 12) * 12);
  high = Math.min(high, Math.floor(PIANO.high / 12) * 12);
  let whites = 0;
  for (let n = low; n <= high; n++) if (!isBlack(n)) whites++;
  const minKey = view.landscape ? MIN_KEY_LANDSCAPE : MIN_KEY_PORTRAIT;
  return { low, high, whites, minKey, scrolls: whites * minKey > view.width };
}
