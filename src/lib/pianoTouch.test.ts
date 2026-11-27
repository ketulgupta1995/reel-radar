import { describe, expect, it } from "vitest";
import { MIN_TOUCH_SAMPLES, touchLine, touchStats } from "./pianoTouch";

const run = (v: Record<number, number[]>) => Object.entries(v).flatMap(([f, vs]) => vs.map((velocity) => ({ finger: Number(f), velocity })));

describe("evenness of touch", () => {
  it("needs enough keyboard notes", () => {
    expect(touchStats(run({ 1: [80, 80, 80] }))).toBeNull();
    expect(touchStats(run({ 1: Array(MIN_TOUCH_SAMPLES).fill(0) }))).toBeNull(); // velocity 0 and bad fingers are dropped
    expect(touchStats(run({ 7: Array(MIN_TOUCH_SAMPLES).fill(80) }))).toBeNull();
  });
  it("scores 100 for perfectly even notes", () => {
    const t = touchStats(run({ 1: [80, 80], 2: [80, 80], 3: [80, 80], 4: [80, 80] }))!;
    expect(t).toMatchObject({ n: 8, mean: 80, spread: 0, evenness: 100, weak: null, strong: null });
    expect(touchLine(t)).toBe("Your fingers play about equally hard.");
  });
  it("finds the hard thumb and the weak fifth finger", () => {
    const t = touchStats(run({ 1: [110, 105], 2: [80, 80], 3: [80, 82], 4: [75, 75], 5: [50, 55] }))!;
    expect(t.fingers.map((f) => [f.finger, f.mean])).toEqual([[1, 108], [2, 80], [3, 81], [4, 75], [5, 53]]);
    expect(t.strong).toBe(1);
    expect(t.weak).toBe(5);
    expect(t.evenness).toBeLessThan(80);
    expect(touchLine(t)).toBe("Your thumb plays hardest and finger 5 softest.");
  });
  it("names the softest finger when two are weak", () => {
    const t = touchStats(run({ 1: [90, 90], 2: [90, 90], 3: [90, 90], 4: [60, 60], 5: [40, 40] }))!;
    expect(t.weak).toBe(5);
  });
  it("says it when only one side stands out", () => {
    const weak = touchStats(run({ 1: [80, 80], 2: [80, 80], 3: [80, 80], 4: [40, 40] }))!;
    expect(touchLine(weak)).toBe("Finger 4 plays softer than the others.");
    const strong = touchStats(run({ 1: [120, 120], 2: [80, 80], 3: [80, 80], 4: [80, 80] }))!;
    expect(touchLine(strong)).toBe("Thumb plays harder than the others.");
  });
});
