import { describe, expect, it } from "vitest";
import { buildSong } from "./pianoSongs";
import { advance, autoNotes, expectedPitches, press, startWait, stepDelayMs, stepsPlayed } from "./pianoSongWait";

// Step 0: RH E4 + LH C3 chord (C3 E3 G3); step 1: RH D4 only; step 2: LH only (G2); step 3: RH C4+E4 (a chord).
const song = buildSong({
  id: "t", title: "T", level: 1, bpm: 120, beatsPerBar: 4, key: "C",
  rh: "E4/3 D4/2 R:1 C4+E4/1+3", lh: "C3+E3+G3:2/5+3+1 G2/5 R:1",
});
const held = (...n: number[]) => new Set(n);

describe("wait mode", () => {
  it("expects only the chosen hand's notes and leaves the other to the app", () => {
    const r = startWait(song, "R");
    expect(expectedPitches(r)).toEqual([64]);
    expect(autoNotes(r).map((n) => n.pitch)).toEqual([48, 52, 55]);
    const l = startWait(song, "L");
    expect(expectedPitches(l)).toEqual([48, 52, 55]);
    expect(autoNotes(l).map((n) => n.pitch)).toEqual([64]);
    const both = startWait(song, "both");
    expect(expectedPitches(both)).toEqual([48, 52, 55, 64]);
    expect(autoNotes(both)).toEqual([]);
  });

  it("advances only on the right key and counts a wrong key as a miss", () => {
    let s = startWait(song, "R");
    let out = press(s, 60, held(60));
    expect(out.result).toBe("miss");
    expect(out.state.misses).toBe(1);
    expect(out.state.index).toBe(0);
    s = out.state;
    out = press(s, 64, held(64));
    expect(out.result).toBe("advance");
    expect(out.state.index).toBe(1);
    expect(out.state.misses).toBe(1);
  });

  it("needs every note of a chord held, in any order", () => {
    let s = startWait(song, "L");
    let out = press(s, 52, held(52));
    expect(out.result).toBe("hit");
    expect(out.state).toBe(s); // unchanged
    out = press(s, 48, held(52, 48));
    expect(out.result).toBe("hit");
    out = press(s, 55, held(52, 48, 55));
    expect(out.result).toBe("advance");
    s = out.state;
    expect(s.index).toBe(1);
  });

  it("ignores keys on a step with nothing for the player, which moves on by itself", () => {
    let s = startWait(song, "R");
    s = advance(advance(s)); // step 2: only the left hand
    expect(expectedPitches(s)).toEqual([]);
    expect(autoNotes(s).map((n) => n.pitch)).toEqual([43]);
    expect(press(s, 60, held(60)).result).toBe("ignored");
    expect(press(s, 60, held(60)).state.misses).toBe(0);
    expect(stepDelayMs(s, 1)).toBe(500); // one beat at 120 BPM until the next step
    expect(stepDelayMs(s, 0.5)).toBe(1000); // half speed
  });

  it("finishes after the last step and counts the steps played", () => {
    let s = startWait(song, "R");
    expect(stepsPlayed(s)).toBe(0);
    s = advance(advance(advance(s)));
    expect(s.done).toBe(false);
    const out = press(s, 60, held(60, 64)); // step 3 is the chord C4 + E4; 64 not pressed in this event but held
    expect(out.result).toBe("done");
    expect(out.state.done).toBe(true);
    expect(stepsPlayed(out.state)).toBe(4);
    expect(expectedPitches(out.state)).toEqual([]);
    expect(press(out.state, 60, held(60)).result).toBe("ignored");
    expect(advance(out.state)).toBe(out.state);
    expect(stepDelayMs(out.state, 1)).toBe(0);
  });

  it("times the last step by its longest note and handles an empty song", () => {
    const s = advance(advance(advance(startWait(song, "R"))));
    expect(stepDelayMs(s, 1)).toBe(500);
    expect(startWait({ ...song, notes: [] }, "R").done).toBe(true);
  });
});
