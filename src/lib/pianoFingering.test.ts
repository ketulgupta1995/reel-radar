import { describe, expect, it } from "vitest";
import { POSITION_SPAN, suggestFingering } from "./pianoFingering";

const line = (...pitches: number[]) => pitches.map((pitch, i) => ({ start: i, pitch }));
const chord = (...pitches: number[]) => pitches.map((pitch) => ({ start: 0, pitch }));

describe("suggestFingering: chords", () => {
  it("fingers a triad 1-3-5 in the right hand and 5-3-1 in the left, lowest note first", () => {
    expect(suggestFingering(chord(60, 64, 67), "R")).toEqual([1, 3, 5]);
    expect(suggestFingering(chord(48, 52, 55), "L")).toEqual([5, 3, 1]);
  });
  it("uses the size of a two-note interval", () => {
    expect(suggestFingering(chord(60, 67), "R")).toEqual([1, 5]); // a fifth
    expect(suggestFingering(chord(60, 64), "R")).toEqual([1, 3]); // a third
    expect(suggestFingering(chord(48, 55), "L")).toEqual([5, 1]);
    expect(suggestFingering(chord(48, 51), "L")).toEqual([3, 1]);
  });
  it("handles four, five and more notes", () => {
    expect(suggestFingering(chord(60, 64, 67, 71), "R")).toEqual([1, 2, 3, 5]);
    expect(suggestFingering(chord(48, 52, 55, 59), "L")).toEqual([5, 3, 2, 1]);
    expect(suggestFingering(chord(60, 62, 64, 65, 67), "R")).toEqual([1, 2, 3, 4, 5]);
    expect(suggestFingering(chord(60, 62, 64, 65, 67, 69), "R")).toEqual([1, 2, 3, 4, 5, 5]);
  });
  it("returns fingers in the order the notes were given", () => {
    expect(suggestFingering(chord(67, 60, 64), "R")).toEqual([5, 1, 3]);
  });
});

describe("suggestFingering: single-note lines", () => {
  it("puts the thumb on the lowest note of a C position, right hand", () => {
    expect(suggestFingering(line(60, 62, 64, 65, 67, 65, 64, 62, 60), "R")).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
  });
  it("mirrors it for the left hand: the thumb is on the top note", () => {
    expect(suggestFingering(line(48, 50, 52, 53, 55), "L")).toEqual([5, 4, 3, 2, 1]);
    expect(suggestFingering(line(55, 53, 52, 50, 48), "L")).toEqual([1, 2, 3, 4, 5]);
  });
  it("fingers black keys by their distance from the anchor", () => {
    expect(suggestFingering(line(60, 61, 63, 66), "R")).toEqual([1, 2, 3, 4]);
  });
  it("starts a position from the notes that follow, so a line that goes down fits", () => {
    expect(suggestFingering(line(67, 65, 64, 62, 60), "R")).toEqual([5, 4, 3, 2, 1]);
  });
  it("shifts the position when a note falls outside it", () => {
    const f = suggestFingering(line(60, 62, 64, 65, 67, 72, 74, 76), "R");
    expect(f.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(f.slice(5)).toEqual([1, 2, 3]); // the hand moved up to a new position on 72
  });
  it("never gives a finger outside 1-5 and keeps positions within the span", () => {
    const pitches = Array.from({ length: 200 }, (_, i) => 50 + ((i * 7) % 30));
    for (const hand of ["R", "L"] as const) {
      const f = suggestFingering(line(...pitches), hand);
      expect(f).toHaveLength(200);
      expect(f.every((x) => x >= 1 && x <= 5)).toBe(true);
    }
    expect(POSITION_SPAN).toBe(7);
  });
  it("drops the position after a chord and handles an empty part", () => {
    const f = suggestFingering([{ start: 0, pitch: 60 }, { start: 1, pitch: 64 }, { start: 1, pitch: 67 }, { start: 2, pitch: 72 }], "R");
    expect(f).toEqual([1, 1, 3, 1]);
    expect(suggestFingering([], "R")).toEqual([]);
  });
});
