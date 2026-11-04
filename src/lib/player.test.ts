import { describe, expect, it } from "vitest";
import { PlayerAction, PlayerState, chunkSentence, initialPlayer, playerReducer } from "./player";

const run = (state: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, state);
const loaded = (index = 0, play = false) => run(initialPlayer(), { type: "LOAD", key: "0", count: 3, index, play });

describe("playerReducer", () => {
  it("plays through the chapter and finishes after the last sentence", () => {
    let s = run(loaded(), { type: "PLAY" });
    expect(s).toMatchObject({ status: "playing", index: 0 });
    s = run(s, { type: "ENDED", runId: s.runId });
    s = run(s, { type: "ENDED", runId: s.runId });
    expect(s).toMatchObject({ status: "playing", index: 2 });
    s = run(s, { type: "ENDED", runId: s.runId });
    expect(s.status).toBe("finished");
  });

  it("ignores an end event from a sentence that was cancelled", () => {
    const playing = run(loaded(), { type: "PLAY" });
    const jumped = run(playing, { type: "JUMP", index: 2 });
    expect(jumped.runId).toBeGreaterThan(playing.runId);
    expect(run(jumped, { type: "ENDED", runId: playing.runId })).toBe(jumped);
  });

  it("pauses in place, and playing again speaks the same sentence anew", () => {
    const playing = run(loaded(1), { type: "PLAY" });
    const paused = run(playing, { type: "PAUSE" });
    expect(paused).toMatchObject({ status: "paused", index: 1 });
    expect(run(paused, { type: "ENDED", runId: paused.runId })).toBe(paused);
    const again = run(paused, { type: "PLAY" });
    expect(again).toMatchObject({ status: "playing", index: 1 });
    expect(again.runId).toBeGreaterThan(paused.runId);
    expect(run(loaded(), { type: "PAUSE" }).status).toBe("stopped");
  });

  it("jumps within the chapter, staying paused when paused and speaking at once when playing", () => {
    expect(run(loaded(), { type: "JUMP", index: 9 }).index).toBe(2);
    expect(run(loaded(), { type: "JUMP", index: -4 }).index).toBe(0);
    const paused = run(loaded(), { type: "JUMP", index: 1 });
    expect(paused).toMatchObject({ status: "stopped", index: 1, runId: loaded().runId });
    const playing = run(loaded(), { type: "PLAY" });
    expect(run(playing, { type: "JUMP", index: 1 }).runId).toBe(playing.runId + 1);
  });

  it("starts over after finishing, and a jump after finishing leaves it paused", () => {
    let finished = run(loaded(2), { type: "PLAY" });
    finished = run(finished, { type: "ENDED", runId: finished.runId });
    expect(finished.status).toBe("finished");
    expect(run(finished, { type: "JUMP", index: 1 })).toMatchObject({ status: "paused", index: 1 });
    expect(run(finished, { type: "PLAY" })).toMatchObject({ status: "playing", index: 0 });
  });

  it("loads a chapter at a position, playing or not, and does nothing with an empty chapter", () => {
    expect(loaded(1, true)).toMatchObject({ status: "playing", index: 1, count: 3, key: "0" });
    const empty = run(initialPlayer(), { type: "LOAD", key: "1", count: 0, index: 0, play: true });
    expect(empty.status).toBe("stopped");
    expect(run(empty, { type: "PLAY" })).toBe(empty);
    expect(run(empty, { type: "JUMP", index: 1 })).toBe(empty);
  });
});

describe("chunkSentence", () => {
  it("leaves a short sentence whole", () => {
    expect(chunkSentence("Short one.")).toEqual(["Short one."]);
  });

  it("cuts a long sentence after a comma, with every piece within the limit", () => {
    const text = Array.from({ length: 40 }, (_, i) => `clause number ${i} goes on`).join(", ") + ".";
    const chunks = chunkSentence(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.slice(0, -1).every((c) => c.endsWith(","))).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("cuts at a space when there is no punctuation, and anywhere when there are no spaces", () => {
    const words = chunkSentence("word ".repeat(100).trim(), 50);
    expect(words.every((c) => c.length <= 50 && !c.endsWith(" "))).toBe(true);
    expect(words.join(" ")).toBe("word ".repeat(100).trim());
    expect(chunkSentence("x".repeat(250), 100).map((c) => c.length)).toEqual([100, 100, 50]);
  });
});
