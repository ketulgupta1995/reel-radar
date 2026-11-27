import { describe, expect, it } from "vitest";
import { DrillRound } from "./pianoDrill";
import { CHORD_DRILL, chordName, chordPcs, chordShape, judgeChord } from "./pianoChordDrill";

const item = (id: string) => CHORD_DRILL.items.find((i) => i.id === id)!;
const judge = (id: string, held: number[], note: number) => judgeChord(item(id), new Set(held), { note });

describe("chord table", () => {
  it("names chords with conventional spelling", () => {
    expect(CHORD_DRILL.items.map((i) => CHORD_DRILL.label(i))).toEqual(expect.arrayContaining(["C", "Am", "B♭", "E♭", "A♭", "D♭", "F#", "C#m", "F#m", "G#m", "B♭m", "E♭m", "G7", "B♭7"]));
    expect(chordName(10, "maj")).toBe("B♭");
    expect(chordName(1, "min")).toBe("C#m");
  });
  it("has unique ids, 12 majors, 12 minors, and the groups in unlock order", () => {
    const ids = CHORD_DRILL.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHORD_DRILL.items.filter((i) => i.quality === "maj")).toHaveLength(12);
    expect(CHORD_DRILL.items.filter((i) => i.quality === "min")).toHaveLength(12);
    expect(CHORD_DRILL.groupNames.slice(0, 2)).toEqual(["C F G", "Am Dm Em"]);
    expect(CHORD_DRILL.items.filter((i) => i.group === 3).map((i) => i.id)).toEqual(["C7", "G7", "D7", "A7", "E7", "F7", "Bb7", "B7"]);
    expect(CHORD_DRILL.items.filter((i) => i.group === 2)).toHaveLength(18);
  });
  it("derives pitch classes", () => {
    expect([...chordPcs(item("Am"))].sort((a, b) => a - b)).toEqual([0, 4, 9]);
    expect([...chordPcs(item("G7"))].sort((a, b) => a - b)).toEqual([2, 5, 7, 11]);
  });
});

describe("chord fingering", () => {
  it("is root position above middle C, 1-3-5 and 1-2-3-5 for sevenths", () => {
    expect(chordShape(item("C"))).toEqual({ notes: [60, 64, 67], fingers: { 60: 1, 64: 3, 67: 5 } });
    expect(chordShape(item("Am")).notes).toEqual([69, 72, 76]);
    expect(chordShape(item("G7"))).toEqual({ notes: [67, 71, 74, 77], fingers: { 67: 1, 71: 2, 74: 3, 77: 5 } });
    expect(CHORD_DRILL.hint(item("C"), { low: 48, high: 84 })).toEqual({ lit: new Set([60, 64, 67]), fingers: { 60: 1, 64: 3, 67: 5 } });
    for (const i of CHORD_DRILL.items) expect(Math.max(...chordShape(i).notes)).toBeLessThanOrEqual(84);
  });
});

describe("chord judging", () => {
  it("is pending until every pitch class is held, in any octave, inversion or doubling", () => {
    expect(judge("C", [60], 60)).toBe("pending");
    expect(judge("C", [60, 64], 64)).toBe("pending");
    expect(judge("C", [60, 64, 67], 67)).toBe("correct");
    expect(judge("C", [55, 64, 72], 72)).toBe("correct"); // G3 E4 C5
    expect(judge("C", [48, 60, 64, 67], 67)).toBe("correct"); // doubled root
    expect(judge("G7", [43, 59, 62, 65], 65)).toBe("correct");
  });
  it("calls a pitch class outside the chord a miss", () => {
    expect(judge("C", [60, 61], 61)).toBe("miss");
    expect(judge("C", [60, 64, 67, 70], 70)).toBe("miss");
  });
  it("ignores stale keys: they are not a miss, but hold the chord back until released", () => {
    // D (62) left down from the last chord; C major is played on top.
    expect(judge("C", [62, 60], 60)).toBe("pending");
    expect(judge("C", [62, 60, 64, 67], 67)).toBe("pending");
    expect(judge("C", [60, 64, 67], 67)).toBe("correct");
  });
  it("works through the engine, with the held set updated by note-offs", () => {
    let t = 0;
    const round = new DrillRound({ def: CHORD_DRILL, settings: { unlocked: 1, slowStep: 0 }, now: () => t, rng: () => 0 });
    expect(round.current.id).toBe("C");
    t = 100;
    round.handle({ type: "on", note: 62, time: t }); // stray D: a miss
    expect(round.missed).toBe(true);
    round.handle({ type: "on", note: 60, time: t });
    round.handle({ type: "on", note: 64, time: t });
    expect(round.handle({ type: "on", note: 67, time: t }).advanced).toBe(false); // D still held
    expect(round.handle({ type: "off", note: 62, time: t }).advanced).toBe(true); // lifting the stray D completes C
  });
  it("answers on a note-off when lifting the last stale key completes the chord (C to F, keeping C)", () => {
    let t = 0;
    const round = new DrillRound({ def: CHORD_DRILL, settings: { unlocked: 1, slowStep: 0 }, now: () => t, rng: () => 0 });
    expect(round.current.id).toBe("C");
    for (const n of [60, 64, 67]) round.handle({ type: "on", note: n, time: t });
    expect(round.current.id).toBe("F"); // C, E, G still held
    t = 500;
    expect(round.handle({ type: "on", note: 65, time: t }).advanced).toBe(false);
    expect(round.handle({ type: "on", note: 69, time: t }).advanced).toBe(false);
    expect(round.handle({ type: "off", note: 64, time: t }).advanced).toBe(false); // G still down
    t = 900;
    const r = round.handle({ type: "off", note: 67, time: t }); // C, F, A held: F major
    expect(r).toMatchObject({ outcome: "correct", advanced: true });
    expect(round.missed).toBe(false);
    expect(round.finish("s", t).record!.items.F).toMatchObject({ attempts: 1, misses: 0, avgMs: 900 });
  });
  it("settles only on the exact chord", () => {
    const c = CHORD_DRILL.items.find((i) => i.id === "C")!;
    expect(CHORD_DRILL.settle!(c, new Set([48, 64, 67]))).toBe(true);
    expect(CHORD_DRILL.settle!(c, new Set([60, 64]))).toBe(false);
    expect(CHORD_DRILL.settle!(c, new Set([60, 64, 67, 62]))).toBe(false);
  });
});
