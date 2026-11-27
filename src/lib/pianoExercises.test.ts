import { describe, expect, it } from "vitest";
import { EXERCISES, EXERCISE_DEFS, exerciseById } from "./pianoExercises";
import { SONGS } from "./pianoSongLibrary";
import { handOf, parseHand, songBeats, stepsOf } from "./pianoSongs";

describe("coordination exercises", () => {
  it("has eight, easiest first, with ids that don't clash with songs", () => {
    expect(EXERCISES).toHaveLength(8);
    expect(new Set(EXERCISES.map((s) => s.id)).size).toBe(8);
    const levels = EXERCISES.map((s) => s.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    for (const e of EXERCISES) expect(SONGS.some((s) => s.id === e.id)).toBe(false);
    expect(exerciseById("coord-contrary")?.title).toBe("Contrary motion");
    expect(exerciseById("nope")).toBeUndefined();
  });

  it("fills every bar in both hands: eight bars of four beats, the hands lined up", () => {
    for (const d of EXERCISE_DEFS) {
      const r = parseHand(d.rh, "R").bars;
      expect(r, d.title).toEqual(Array(8).fill(4));
      expect(parseHand(d.lh, "L").bars, d.title).toEqual(r);
    }
    for (const e of EXERCISES) expect(songBeats(e)).toBe(32);
  });

  for (const e of EXERCISES) {
    it(`${e.title}: fingers 1-5, right hand in C position, left hand low, no overlaps`, () => {
      const rh = handOf(e.notes, "R");
      const lh = handOf(e.notes, "L");
      expect(rh.length).toBeGreaterThan(6);
      expect(lh.length).toBeGreaterThan(6);
      for (const n of e.notes) {
        expect(n.finger).toBeGreaterThanOrEqual(1);
        expect(n.finger).toBeLessThanOrEqual(5);
        expect(n.suggested).toBeUndefined();
      }
      for (const n of rh) {
        expect(n.pitch).toBeGreaterThanOrEqual(60);
        expect(n.pitch).toBeLessThanOrEqual(67);
        expect(n.finger).toBe([60, 62, 64, 65, 67].indexOf(n.pitch) + 1); // thumb on C4
      }
      expect(Math.max(...lh.map((n) => n.pitch))).toBeLessThan(Math.min(...rh.map((n) => n.pitch)));
      for (const hand of [rh, lh]) for (const a of hand) for (const b of hand) if (a !== b && a.start < b.start) expect(a.start + a.dur).toBeLessThanOrEqual(b.start + 1e-9);
    });
  }

  it("builds up from a held note to the harder patterns", () => {
    const lhOf = (id: string) => handOf(exerciseById(id)!.notes, "L");
    expect(lhOf("coord-held-c").map((n) => [n.pitch, n.dur])).toEqual([[48, 4], [48, 4], [48, 4], [48, 4], [43, 4], [43, 4], [48, 4], [48, 4]]);
    expect(lhOf("coord-half-roots").every((n) => n.dur === 2 || n.dur === 4)).toBe(true);
    const pulses = lhOf("coord-chord-pulse");
    expect(pulses).toHaveLength(8 * 4 * 3); // a triad on every beat
    expect(pulses.every((n) => n.dur === 1)).toBe(true);
    const broken = lhOf("coord-broken-chord");
    expect(broken[0].pitch).toBe(48);
    expect(broken[1].pitch).toBe(55); // the fifth
    const dotted = handOf(exerciseById("coord-dotted-rhythm")!.notes, "R");
    expect(dotted.filter((n) => n.dur === 1.5).length).toBeGreaterThan(8);
  });

  it("moves the hands in contrary, parallel and alternating patterns", () => {
    const dir = (id: string, h: "R" | "L") => {
      const p = handOf(exerciseById(id)!.notes, h).map((n) => n.pitch);
      return p[1] - p[0];
    };
    expect(dir("coord-contrary", "R")).toBeGreaterThan(0);
    expect(dir("coord-contrary", "L")).toBeLessThan(0);
    const par = exerciseById("coord-parallel")!;
    expect(handOf(par.notes, "L").map((n) => n.pitch + 12)).toEqual(handOf(par.notes, "R").map((n) => n.pitch));
    const alt = stepsOf(exerciseById("coord-alternating")!);
    expect(alt.every((s) => new Set(s.notes.map((n) => n.hand)).size === 1)).toBe(true); // never together
    expect(new Set(alt.map((s) => s.notes[0].hand))).toEqual(new Set(["R", "L"]));
  });
});
