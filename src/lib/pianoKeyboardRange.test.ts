import { describe, expect, it } from "vitest";
import { keyboardRange } from "./pianoKeyboardRange";

const land = { width: 1000, landscape: true };

describe("keyboardRange", () => {
  it("is at least C3 to C5, even for no notes or one note", () => {
    expect(keyboardRange([], land)).toMatchObject({ low: 48, high: 72, whites: 15 });
    expect(keyboardRange([60], land)).toMatchObject({ low: 48, high: 72 });
  });
  it("pads the notes out to whole octaves, C up to a C", () => {
    expect(keyboardRange([55, 67], land)).toMatchObject({ low: 48, high: 72 });
    expect(keyboardRange([40, 66], land)).toMatchObject({ low: 36, high: 72 });
    expect(keyboardRange([62, 79], land)).toMatchObject({ low: 48, high: 84 });
    expect(keyboardRange([72], land)).toMatchObject({ high: 72 });
  });
  it("stays on the 88 keys", () => {
    expect(keyboardRange([21, 108], land)).toMatchObject({ low: 24, high: 108 });
  });
  it("wants 44 px keys in landscape and scrolls when they don't fit", () => {
    expect(keyboardRange([], { width: 660, landscape: true })).toMatchObject({ minKey: 44, scrolls: false }); // 15 x 44
    expect(keyboardRange([], { width: 659, landscape: true }).scrolls).toBe(true);
    expect(keyboardRange([36, 84], { width: 960, landscape: true }).scrolls).toBe(true); // 29 whites
  });
  it("keeps today's 28 px minimum in portrait", () => {
    expect(keyboardRange([], { width: 420, landscape: false })).toMatchObject({ minKey: 28, scrolls: false }); // 15 x 28
    expect(keyboardRange([36, 84], { width: 400, landscape: false }).scrolls).toBe(true);
  });
});
