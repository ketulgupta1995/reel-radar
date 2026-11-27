import { describe, expect, it } from "vitest";
import { HANDS_LADDER, SongProgress, applyRun, ladderTempo, mergeProgress, nextTempo, progressLine, startTempo, waitDoneWell } from "./pianoSongLadder";

const song = { bpm: 100 };
const P = (p: Partial<SongProgress> = {}): SongProgress => ({ step: 0, tempo: 60, best: 0, at: 1, ...p });
const wait = (hands: "R" | "L" | "both", misses: number, steps = 26, finished = true) => ({ mode: "wait" as const, hands, finished, misses, steps });
const play = (hands: "R" | "L" | "both", onTime: number, tempo: number) => ({ mode: "play" as const, hands, onTime, tempo });

describe("tempo ladder", () => {
  it("starts near 60% of the song tempo, in steps of 5, never above the song", () => {
    expect(startTempo(100)).toBe(60);
    expect(startTempo(110)).toBe(65);
    expect(startTempo(72)).toBe(45);
    expect(startTempo(50)).toBe(40); // never below the metronome's floor
    expect(startTempo(40)).toBe(40);
    expect(ladderTempo(song)).toBe(60);
    expect(ladderTempo(song, P({ tempo: 85 }))).toBe(85);
  });
  it("goes up 5 BPM at 90% on time, stays below, and stops at the song tempo", () => {
    expect(nextTempo(60, 100, 0.9)).toBe(65);
    expect(nextTempo(60, 100, 0.89)).toBe(60);
    expect(nextTempo(98, 100, 1)).toBe(100);
    expect(nextTempo(100, 100, 1)).toBe(100);
  });
});

describe("hands ladder", () => {
  it("is right, left, both in wait mode, then both at tempo", () => {
    expect(HANDS_LADDER.map((s) => `${s.hands}/${s.mode}`)).toEqual(["R/wait", "L/wait", "both/wait", "both/play"]);
  });
  it("calls a wait step done with at most 2 misses or 10% of the steps", () => {
    expect(waitDoneWell(2, 20)).toBe(true);
    expect(waitDoneWell(3, 20)).toBe(false);
    expect(waitDoneWell(5, 50)).toBe(true);
    expect(waitDoneWell(6, 50)).toBe(false);
  });
  it("suggests the next step after a good finished wait run, from any starting point", () => {
    const a = applyRun(song, undefined, wait("R", 1), 10);
    expect(a).toMatchObject({ stepDone: true, changed: true, progress: { step: 1, at: 10 } });
    expect(applyRun(song, a.progress, wait("L", 0), 20).progress.step).toBe(2);
    expect(applyRun(song, P({ step: 2 }), wait("both", 0), 20).progress.step).toBe(3);
    expect(applyRun(song, P(), wait("both", 0), 20).progress.step).toBe(3); // skipping ahead counts
  });
  it("does not move on a bad or unfinished run, or a step already passed", () => {
    expect(applyRun(song, undefined, wait("R", 3), 10)).toMatchObject({ stepDone: false, changed: false });
    expect(applyRun(song, P(), wait("R", 0, 26, false), 10)).toMatchObject({ stepDone: false, changed: false });
    const again = applyRun(song, P({ step: 2 }), wait("R", 0), 10);
    expect(again.progress.step).toBe(2);
    expect(again.changed).toBe(false);
  });
  it("needs a good run at the full song tempo, with both hands, to master a song", () => {
    const slow = applyRun(song, P({ step: 3, tempo: 95 }), play("both", 0.95, 95), 10);
    expect(slow).toMatchObject({ stepDone: false, mastered: false, nextTempo: 100, progress: { tempo: 100, best: 95 } });
    const full = applyRun(song, slow.progress, play("both", 0.9, 100), 20);
    expect(full).toMatchObject({ stepDone: true, mastered: true, progress: { mastered: true, step: 3 } });
    expect(applyRun(song, P({ step: 3, tempo: 100 }), play("both", 0.85, 100), 20).mastered).toBe(false);
    expect(applyRun(song, P({ step: 1, tempo: 100 }), play("R", 1, 100), 20).mastered).toBe(false); // one hand never masters
  });
  it("play-along runs raise tempo and best only; a bad first run that changes nothing needs no write", () => {
    expect(applyRun(song, undefined, play("R", 0, 60), 10)).toMatchObject({ changed: false, nextTempo: 60 });
    const r = applyRun(song, P({ best: 80 }), play("R", 0.7, 60), 10);
    expect(r.changed).toBe(false);
    expect(r.progress.best).toBe(80); // best never drops
    expect(applyRun(song, P({ best: 80 }), play("R", 0.93, 60), 10)).toMatchObject({ changed: true, progress: { tempo: 65, best: 93 } });
  });
});

describe("progress merge and display", () => {
  it("never goes backwards", () => {
    expect(mergeProgress(P({ step: 2, tempo: 70, best: 80, at: 5 }), P({ step: 1, tempo: 90, best: 60, mastered: true, at: 9 }))).toEqual({ step: 2, tempo: 90, best: 80, mastered: true, at: 9 });
    expect(mergeProgress(undefined, P())).toEqual(P());
    expect(mergeProgress(P(), undefined)).toEqual(P());
    expect(mergeProgress(undefined, undefined)).toBeUndefined();
  });
  it("describes progress in one line", () => {
    expect(progressLine(undefined)).toBe("");
    expect(progressLine(P({ step: 2, best: 91 }))).toBe("Step 3 of 4: Both hands, wait · best 91%");
    expect(progressLine(P({ step: 0 }))).toBe("Step 1 of 4: Right hand, wait");
    expect(progressLine(P({ step: 3, best: 97, mastered: true }))).toBe("Mastered · best 97%");
  });
});
