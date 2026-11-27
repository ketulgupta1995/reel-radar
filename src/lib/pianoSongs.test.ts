import { describe, expect, it } from "vitest";
import { buildSong, chordAt, chordLabel, chordPitchClasses, chordVoicing, handOf, parseChords, parseHand, parsePitch, songBeats, songRange, stepsOf } from "./pianoSongs";

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

describe("chord charts (melody + chords)", () => {
  it("reads chord names and voices them close to C3 with 5-3-1 (5-3-2-1 for four notes)", () => {
    expect(chordPitchClasses("C")).toEqual([0, 4, 7]);
    expect(chordPitchClasses("F#m")).toEqual([6, 9, 1]);
    expect(chordPitchClasses("Bb7")).toEqual([10, 2, 5, 8]);
    expect(chordPitchClasses("Am7")).toEqual([9, 0, 4, 7]);
    expect(chordPitchClasses("Fmaj7")).toEqual([5, 9, 0, 4]);
    expect(() => chordPitchClasses("H")).toThrow('Bad chord "H"');
    expect(chordVoicing("C")).toEqual({ pitches: [48, 52, 55], fingers: [5, 3, 1] });
    expect(chordVoicing("G").pitches).toEqual([47, 50, 55]); // B2 D3 G3
    expect(chordVoicing("Am").pitches).toEqual([48, 52, 57]);
    expect(chordVoicing("G7")).toEqual({ pitches: [47, 50, 53, 55], fingers: [5, 3, 2, 1] });
    expect(chordLabel("Bb7")).toBe("B♭7");
    expect(chordLabel("Am")).toBe("Am");
  });
  it("splits bars between chords, holds a chord over the bar line and rests on '-'", () => {
    expect(parseChords("C | C G | - | F:1 G7 | N.C. C", [4, 4, 4, 4, 4])).toEqual([
      { start: 0, dur: 6, name: "C" },
      { start: 6, dur: 2, name: "G" },
      { start: 12, dur: 1, name: "F" },
      { start: 13, dur: 3, name: "G7" },
      { start: 18, dur: 2, name: "C" },
    ]);
    expect(parseChords("- | C", [1, 3])).toEqual([{ start: 1, dur: 3, name: "C" }]); // a pickup
  });
  it("refuses charts that don't fit the melody", () => {
    expect(() => parseChords("C | F", [4])).toThrow("Chords have 2 bars, the melody 1");
    expect(() => parseChords(" ", [4])).toThrow('Bar 1 has no chord (use "-" for none)');
    expect(() => parseChords("C:3", [4])).toThrow("Bar 1: chord lengths don't fill 4 beats");
    expect(() => parseChords("C:4 G", [4])).toThrow("Bar 1: chord lengths don't fill 4 beats");
    expect(() => parseChords("C:5 G", [4])).toThrow("Bar 1: chord lengths don't fill 4 beats");
    expect(() => parseChords("X", [4])).toThrow('Bad chord "X"');
  });
  it("builds a song whose left hand holds each chord, and finds the chord at a beat", () => {
    const s = buildSong({ id: "x", title: "X", level: 1, bpm: 90, beatsPerBar: 4, key: "C", rh: "E4:4/3 | D4:2/2 C4:2/1", chords: "C | G C" });
    expect(s.chords).toEqual([
      { start: 0, dur: 4, name: "C" },
      { start: 4, dur: 2, name: "G" },
      { start: 6, dur: 2, name: "C" },
    ]);
    expect(handOf(s.notes, "L").filter((n) => n.start === 4).map((n) => n.pitch)).toEqual([47, 50, 55]);
    expect(handOf(s.notes, "L").every((n) => n.dur === (n.start === 0 ? 4 : 2))).toBe(true);
    expect(chordAt(s.chords, 0)).toEqual({ now: s.chords![0], next: s.chords![1] });
    expect(chordAt(s.chords, 6.5)).toEqual({ now: s.chords![2], next: null });
    expect(chordAt(s.chords, 9)).toEqual({ now: null, next: null });
    expect(chordAt(undefined, 0)).toEqual({ now: null, next: null });
  });
});
