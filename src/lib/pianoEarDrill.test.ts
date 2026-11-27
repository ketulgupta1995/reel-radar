import { describe, expect, it } from "vitest";
import { DrillRound } from "./pianoDrill";
import { EAR_DRILL, EAR_ITEMS, EarItem, REFERENCE, earLabel, earLeadMs, earSound, judgeEar } from "./pianoEarDrill";

const item = (id: string) => EAR_ITEMS.find((i) => i.id === id)!;
const hit = (note: number) => ({ note, time: 0 });

describe("ear training", () => {
  it("has notes of the C position, then phrases, then major or minor", () => {
    expect(EAR_ITEMS.filter((i) => i.group === 0).map((i) => i.id)).toEqual(["note-C", "note-D", "note-E", "note-F", "note-G"]);
    expect(EAR_ITEMS.filter((i) => i.group === 1)).toHaveLength(10);
    expect(EAR_ITEMS.filter((i) => i.group === 2).map((i) => i.id)).toEqual(["chord-C", "chord-Cm", "chord-F", "chord-Fm", "chord-G", "chord-Gm", "chord-D", "chord-Dm", "chord-A", "chord-Am", "chord-E", "chord-Em"]);
    expect(EAR_DRILL.groupNames).toHaveLength(3);
    expect(new Set(EAR_ITEMS.map((i) => i.id)).size).toBe(EAR_ITEMS.length);
  });
  it("plays a reference C before a note, a phrase note by note, a chord struck then broken", () => {
    expect(earSound(item("note-E"))).toEqual({ groups: [[REFERENCE], [64]], gapMs: 700, velocity: [60, 90] });
    expect(earSound(item("phrase-CEG")).groups).toEqual([[60], [64], [67]]);
    expect(earSound(item("chord-Am")).groups).toEqual([[69, 72, 76], [69], [72], [76]]);
    expect(earLeadMs(item("note-E"))).toBe(1000);
    expect(earLeadMs(item("phrase-CEG"))).toBe(2 * 600 + 300 + 2 * 400);
    expect(earLeadMs(item("chord-C"))).toBe(3 * 500 + 300);
  });
  it("hides the answer behind the prompt and names it in the label", () => {
    expect(EAR_DRILL.prompt!(item("note-E"))).toBe("Listen");
    expect(EAR_DRILL.prompt!(item("chord-Cm"))).toBe("Major or minor?");
    expect(earLabel(item("note-E"))).toBe("E");
    expect(earLabel(item("phrase-GEC"))).toBe("G E C");
    expect(earLabel(item("chord-Dm"))).toBe("D minor");
    expect(earLabel(item("chord-A"))).toBe("A major");
    expect(EAR_DRILL.caption!(item("note-C"))).toBe("After the C, play the note you hear");
    expect(EAR_DRILL.caption!(item("phrase-EDC"))).toBe("Play the three notes back. It starts on E");
    expect(EAR_DRILL.caption!(item("chord-G"))).toBe("Root G: play the chord back");
    expect(EAR_DRILL.hintAfterMs).toBe(Infinity);
  });
  it("judges a note in any octave, a phrase in order, a chord by its third", () => {
    expect(judgeEar(item("note-E"), new Set([76]), hit(76))).toBe("correct");
    expect(judgeEar(item("note-E"), new Set([65]), hit(65))).toBe("miss");
    const p = item("phrase-CEG");
    expect(judgeEar(p, new Set(), hit(48), [hit(48)])).toBe("pending");
    expect(judgeEar(p, new Set(), hit(64), [hit(48), hit(64)])).toBe("pending");
    expect(judgeEar(p, new Set(), hit(67), [hit(48), hit(64), hit(67)])).toBe("correct");
    expect(judgeEar(p, new Set(), hit(65), [hit(60), hit(65)])).toBe("miss");
    expect(judgeEar(p, new Set(), hit(60), [hit(60), hit(64), hit(67), hit(60)])).toBe("miss");
    const minor = item("chord-Cm");
    expect(judgeEar(minor, new Set([60, 63]), hit(63))).toBe("pending");
    expect(judgeEar(minor, new Set([60, 63, 67]), hit(67))).toBe("correct");
    expect(judgeEar(minor, new Set([60, 64]), hit(64))).toBe("miss"); // the major third
  });
  it("settles a chord when a stray key is lifted, and lights the answer as the hint", () => {
    const c = item("chord-C");
    expect(EAR_DRILL.settle!(c, new Set([60, 64, 67]))).toBe(true);
    expect(EAR_DRILL.settle!(c, new Set([60, 64]))).toBe(false);
    expect(EAR_DRILL.settle!(item("note-C"), new Set([60]))).toBe(false);
    const range = { low: 48, high: 84 };
    expect([...EAR_DRILL.hint(item("note-F"), range).lit]).toEqual([65]);
    expect(EAR_DRILL.hint(item("phrase-EFG"), range)).toEqual({ lit: new Set([64, 65, 67]), fingers: { 64: 3, 65: 4, 67: 5 } });
    expect([...EAR_DRILL.hint(item("chord-Am"), range).lit]).toEqual([69, 72, 76]);
  });
  it("runs as a DrillRound: a phrase answered over three notes, the sound's time not counted", () => {
    const clock = { t: 0 };
    const phrase = EAR_ITEMS.find((i) => i.id === "phrase-CDE") as EarItem;
    const def = { ...EAR_DRILL, items: [phrase] };
    const round = new DrillRound({ def, settings: { unlocked: 3, slowStep: 0 }, now: () => clock.t, rng: () => 0 });
    expect(round.hintVisible(10_000_000)).toBe(false); // only after a miss
    const press = (note: number, t: number) => round.handle({ type: "on", note, time: (clock.t = t) });
    expect(press(60, 2000).outcome).toBe("pending");
    expect(press(65, 2100).outcome).toBe("miss"); // wrong second note: start the phrase again
    expect(round.hintVisible()).toBe(true);
    expect(press(62, 2200).outcome).toBe("miss"); // not the first note
    press(60, 2300);
    press(62, 2400);
    expect(press(64, 2500)).toMatchObject({ outcome: "correct", advanced: true });
    expect(round.previous?.ms).toBe(2500 - earLeadMs(phrase));
  });
});
