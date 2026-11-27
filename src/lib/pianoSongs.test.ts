import { describe, expect, it } from "vitest";
import { buildSong, handOf, parseHand, parsePitch, songBeats, songRange, stepsOf } from "./pianoSongs";

describe("parsePitch", () => {
  it("reads names with octaves, sharps and flats", () => {
    expect(parsePitch("C4")).toBe(60);
    expect(parsePitch("A4")).toBe(69);
    expect(parsePitch("F#4")).toBe(66);
    expect(parsePitch("Bb3")).toBe(58);
    expect(parsePitch("C-1")).toBe(0);
  });
  it("rejects nonsense", () => {
    expect(() => parsePitch("H4")).toThrow(/Bad pitch/);
    expect(() => parsePitch("C")).toThrow();
  });
});

describe("parseHand", () => {
  it("lays notes out on beats, bar by bar", () => {
    const { notes, bars } = parseHand("E4/3 D4:.5/2 C4:.5/1 R | E4:2/3 R:2", "R");
    expect(bars).toEqual([3, 4]);
    expect(notes.map((n) => [n.start, n.dur, n.pitch, n.finger, n.hand])).toEqual([
      [0, 1, 64, 3, "R"],
      [1, 0.5, 62, 2, "R"],
      [1.5, 0.5, 60, 1, "R"],
      [3, 2, 64, 3, "R"],
    ]);
  });
  it("reads a chord with a finger per note", () => {
    const { notes } = parseHand("C3+E3+G3:4/5+3+1", "L");
    expect(notes.map((n) => [n.start, n.dur, n.pitch, n.finger])).toEqual([
      [0, 4, 48, 5],
      [0, 4, 52, 3],
      [0, 4, 55, 1],
    ]);
  });
  it("needs a finger 1-5 for every note and a sane length", () => {
    expect(() => parseHand("E4", "R")).toThrow(/finger/);
    expect(() => parseHand("E4/6", "R")).toThrow(/finger/);
    expect(() => parseHand("C3+E3/5", "L")).toThrow(/finger/);
    expect(() => parseHand("E4:0/3", "R")).toThrow(/length/);
    expect(() => parseHand("E4:1:2/3", "R")).toThrow(/Bad token/);
  });
});

describe("steps, hands and range", () => {
  const song = buildSong({ id: "t", title: "T", level: 1, bpm: 100, beatsPerBar: 2, key: "C", rh: "E4/3 D4/2 | C4:2/1", lh: "C3:2/5 | G2:2/5" });
  it("groups notes that start together, both hands, in time order", () => {
    const steps = stepsOf(song);
    expect(steps.map((s) => [s.start, s.notes.map((n) => n.pitch)])).toEqual([
      [0, [48, 64]],
      [1, [62]],
      [2, [43, 60]],
    ]);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });
  it("filters by hand", () => {
    expect(handOf(song.notes, "R")).toHaveLength(3);
    expect(handOf(song.notes, "L").map((n) => n.pitch)).toEqual([48, 43]);
    expect(handOf(song.notes, "both")).toHaveLength(5);
  });
  it("pads the range by two semitones and ends on white keys", () => {
    expect(songRange(song)).toEqual({ low: 41, high: 67 }); // 43-2 = 41 (F, white); 64+2 = 66 is F# (black) -> 67
  });
  it("copes with an empty song and measures its length", () => {
    expect(songRange({ notes: [] })).toEqual({ low: 48, high: 72 });
    expect(songBeats(song)).toBe(4);
  });
});
