import { describe, expect, it } from "vitest";
import { FINGER_DRILL, POSITIONS, fingerKey, positionFingers, positionText } from "./pianoFingerDrill";

const pos = (id: string) => POSITIONS.find((p) => p.id === id)!;
const keys = (id: string) => [1, 2, 3, 4, 5].map((f) => fingerKey(pos(id), f));

describe("five-finger positions", () => {
  it("right hand: thumb on the tonic at octave 4, going up", () => {
    expect(keys("RH-C")).toEqual([60, 62, 64, 65, 67]);
    expect(fingerKey(pos("RH-C"), 3)).toBe(64); // E4
    expect(keys("RH-G")).toEqual([67, 69, 71, 72, 74]);
    expect(keys("RH-F")).toEqual([65, 67, 69, 70, 72]); // F G A B♭ C
  });
  it("left hand: little finger on the tonic at octave 3, thumb on the highest key", () => {
    expect(keys("LH-C")).toEqual([55, 53, 52, 50, 48]);
    expect(fingerKey(pos("LH-C"), 5)).toBe(48);
    expect(keys("LH-G")).toEqual([62, 60, 59, 57, 55]);
    expect(keys("LH-F")).toEqual([60, 58, 57, 55, 53]);
  });
  it("D, A and E have their sharps", () => {
    expect(keys("RH-D")).toEqual([62, 64, 66, 67, 69]); // F#
    expect(keys("RH-A")).toEqual([69, 71, 73, 74, 76]); // C#
    expect(keys("RH-E")).toEqual([64, 66, 68, 69, 71]); // G#
    expect(keys("LH-E")).toEqual([59, 57, 56, 54, 52]);
  });
  it("lists positions in unlock order and keeps every key on the keyboard", () => {
    expect(FINGER_DRILL.groupNames).toEqual(["Right hand: C G F", "Left hand: C G F", "Right and Left hand: D A E", "Right and Left hand: B♭ E♭ A♭ B"]);
    expect(POSITIONS.filter((p) => p.group === 0).map((p) => p.id)).toEqual(["RH-C", "RH-G", "RH-F"]);
    expect(POSITIONS.filter((p) => p.group === 3)).toHaveLength(8);
    expect(FINGER_DRILL.items).toHaveLength(POSITIONS.length * 5);
    expect(new Set(FINGER_DRILL.items.map((i) => i.id)).size).toBe(FINGER_DRILL.items.length);
    for (const p of POSITIONS) for (const k of keys(p.id)) expect(k >= 48 && k <= 84).toBe(true);
  });
  it("describes the position, maps keys to fingers and hints the called key", () => {
    expect(positionText(pos("RH-C"))).toBe("Right hand · C position");
    expect(positionText(pos("LH-B♭".replace("♭", "b")))).toBe("Left hand · B♭ position");
    expect(positionFingers(pos("RH-C"))).toEqual({ 60: 1, 62: 2, 64: 3, 65: 4, 67: 5 });
    const item = FINGER_DRILL.items.find((i) => i.id === "RH-C-3")!;
    expect(FINGER_DRILL.label(item)).toBe("3");
    expect(FINGER_DRILL.hint(item, { low: 48, high: 84 })).toEqual({ lit: new Set([64]), fingers: positionFingers(pos("RH-C")) });
    expect(FINGER_DRILL.setup!(item, { low: 48, high: 84 })).toEqual(positionFingers(pos("RH-C")));
  });
  it("knows which finger plays each key of the position (for evenness of touch)", () => {
    const item = FINGER_DRILL.items.find((i) => i.id === "LH-C-1")!;
    expect(FINGER_DRILL.fingerOf!(item, 48)).toBe(5);
    expect(FINGER_DRILL.fingerOf!(item, 55)).toBe(1);
    expect(FINGER_DRILL.fingerOf!(item, 61)).toBeUndefined();
  });
  it("judges the exact key only", () => {
    const item = FINGER_DRILL.items.find((i) => i.id === "RH-C-3")!;
    const j = (note: number) => FINGER_DRILL.judge(item, new Set([note]), { note, time: 0 });
    expect(j(64)).toBe("correct");
    expect(j(76)).toBe("miss"); // another octave
    expect(j(65)).toBe("miss");
  });
});
