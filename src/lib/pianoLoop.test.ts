// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { LOOP_START_SPEED, barCount, clampRange, loadLoop, loopAfterPlay, loopAfterWait, loopKey, rangeText, saveLoop, sliceSong, startLadder } from "./pianoLoop";
import { Song, buildSong } from "./pianoSongs";

const song: Song = buildSong({ id: "t", title: "T", level: 1, bpm: 100, beatsPerBar: 4, key: "C", rh: "C4/1 D4/2 E4:2/3 | F4:4/4 | G4:3/5 A4:2/5 | C5:4/5", chords: "C | F | G | C" });
// bar 3 has G4 (3 beats) and A4 (2 beats) running a beat past the bar line on purpose: slicing must cut it

describe("bar loops", () => {
  it("counts bars and clamps ranges", () => {
    expect(barCount(song)).toBe(5); // 17 beats
    expect(barCount({ notes: [], beatsPerBar: 4 })).toBe(1);
    expect(clampRange(song, { from: 0, to: 9 })).toEqual({ from: 1, to: 5 });
    expect(clampRange(song, { from: 3, to: 1 })).toEqual({ from: 3, to: 3 });
  });
  it("cuts a song to bars, starting at beat 0 and cut off at the range's end", () => {
    const s = sliceSong(song, { from: 2, to: 3 });
    expect(s.id).toBe("t");
    expect(s.notes.filter((n) => n.hand === "R").map((n) => [n.pitch, n.start, n.dur])).toEqual([
      [65, 0, 4],
      [67, 4, 3],
      [69, 7, 1], // cut at the end of bar 3
    ]);
    expect(s.chords).toEqual([
      { start: 0, dur: 4, name: "F" },
      { start: 4, dur: 4, name: "G" },
    ]);
    expect(sliceSong({ ...song, chords: undefined }, { from: 1, to: 1 }).chords).toBeUndefined();
  });
  it("names ranges and keys", () => {
    expect(rangeText({ from: 6, to: 6 })).toBe("bar 6");
    expect(rangeText({ from: 5, to: 8 })).toBe("bars 5–8");
    expect(loopKey("x", { from: 1, to: 2 })).toBe("x:1-2");
  });
  it("climbs its own small ladder", () => {
    const l = startLadder(song);
    expect(l).toEqual({ tempo: 60, speed: LOOP_START_SPEED });
    expect(loopAfterPlay(song, l, 0.95).tempo).toBe(65);
    expect(loopAfterPlay(song, l, 0.5)).toBe(l);
    expect(loopAfterPlay(song, { ...l, tempo: 100 }, 1).tempo).toBe(100);
    expect(loopAfterWait(l, 0).speed).toBe(60);
    expect(loopAfterWait({ ...l, speed: 100 }, 0).speed).toBe(100);
    expect(loopAfterWait(l, 1)).toBe(l);
  });
  it("remembers a loop's ladder on this device and ignores bad values", () => {
    expect(loadLoop(song, { from: 1, to: 2 })).toEqual(startLadder(song));
    saveLoop("t", { from: 1, to: 2 }, { tempo: 75, speed: 70 });
    expect(loadLoop(song, { from: 1, to: 2 })).toEqual({ tempo: 75, speed: 70 });
    expect(loadLoop(song, { from: 2, to: 2 })).toEqual(startLadder(song));
    localStorage.setItem("reel-radar-piano-loops", JSON.stringify({ "t:1-1": { tempo: 999, speed: 5 }, "t:2-3": { tempo: "x" }, "t:4-4": 3 }));
    expect(loadLoop(song, { from: 1, to: 1 })).toEqual({ tempo: 100, speed: 25 });
    expect(loadLoop(song, { from: 2, to: 3 })).toEqual(startLadder(song));
    expect(loadLoop(song, { from: 4, to: 4 })).toEqual(startLadder(song));
    localStorage.setItem("reel-radar-piano-loops", "{bad");
    expect(loadLoop(song, { from: 1, to: 1 })).toEqual(startLadder(song));
  });
  it("survives storage that throws", () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    try {
      expect(() => saveLoop("t", { from: 1, to: 1 }, { tempo: 70, speed: 50 })).not.toThrow();
    } finally {
      Storage.prototype.setItem = set;
    }
  });
});
