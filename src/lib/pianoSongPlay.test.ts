import { describe, expect, it } from "vitest";
import { buildSong } from "./pianoSongs";
import { RUSH_DRAG_MS, barOf, beatTime, onsetsFor, runEndMs, scorePlayAlong, summarize } from "./pianoSongPlay";

// Two 4/4 bars. RH: C4 D4 E4 F4 | G4 G4 A4 A4 ; LH: C3:4 | G2:4
const song = buildSong({ id: "t", title: "T", level: 1, bpm: 120, beatsPerBar: 4, key: "C", rh: "C4/1 D4/2 E4/3 F4/4 | G4/5 G4/5 A4/5 A4/5", lh: "C3:4/5 | G2:4/5" });
const BEAT = 500;
const T0 = 1000; // count-in starts here: the song starts after one bar

describe("play-along timing", () => {
  it("puts the song after a one-bar count-in", () => {
    expect(beatTime(T0, 120, 4, 0)).toBe(T0 + 4 * BEAT);
    expect(beatTime(T0, 120, 4, 2.5)).toBe(T0 + 6.5 * BEAT);
    expect(runEndMs(song, T0, 120)).toBe(T0 + 12 * BEAT);
    expect(onsetsFor(song, "R", T0, 120).map((o) => o.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((b) => T0 + (4 + b) * BEAT));
    expect(onsetsFor(song, "both", T0, 120)).toHaveLength(10);
    expect(barOf(song, song.notes.find((n) => n.pitch === 67)!)).toBe(2);
  });
});

describe("scoring a play-along run", () => {
  const on = onsetsFor(song, "R", T0, 120);
  const hit = (i: number, off = 0, note = on[i].note.pitch) => ({ note, time: on[i].time + off });

  it("grades each note early, on time, late or missed by its own key", () => {
    const hits = [hit(0), hit(1, -150), hit(2, 130), hit(3, 20), hit(4, 0), hit(5, 0, 61)]; // note 5 is played on the wrong key; 6 and 7 are skipped
    const { scores, extra } = scorePlayAlong(on, hits);
    expect(scores.map((s) => s.grade)).toEqual(["on", "early", "late", "on", "on", "missed", "missed", "missed"]);
    expect(scores[1].offsetMs).toBe(-150);
    expect(extra).toBe(1);
    expect(scores.map((s) => s.note)).toEqual(on.map((o) => o.note));
  });
  it("scores repeated notes separately and does not let one hit answer two", () => {
    const { scores } = scorePlayAlong(on, [hit(4), hit(6), hit(7)]);
    expect(scores.slice(4).map((s) => s.grade)).toEqual(["on", "missed", "on", "on"]);
  });
  it("scores the notes of a chord separately and applies the latency offset", () => {
    const both = onsetsFor(song, "both", T0, 120);
    const first = both.filter((o) => o.time === T0 + 4 * BEAT);
    expect(first).toHaveLength(2);
    const hits = first.map((o) => ({ note: o.note.pitch, time: o.time + 60 + (o.note.pitch === 48 ? 100 : 0) }));
    const { scores } = scorePlayAlong(first, hits, { latencyMs: 60 });
    expect(scores.map((s) => [s.note.pitch, s.grade])).toEqual([[48, "on"], [60, "on"]]);
    expect(scores.find((s) => s.note.pitch === 48)!.offsetMs).toBe(100);
  });
});

describe("run summary", () => {
  const on = onsetsFor(song, "R", T0, 120);
  const run = (offs: (number | null)[]) =>
    summarize(song, scorePlayAlong(on, offs.flatMap((o, i) => (o === null ? [] : [{ note: on[i].note.pitch, time: on[i].time + o }]))).scores, 0);

  it("counts on time, early, late and missed, with the average offset", () => {
    const s = run([0, 10, -130, 130, 20, null, -10, 10]);
    expect(s).toMatchObject({ total: 8, onTime: 5, early: 1, late: 1, missed: 1, onTimePct: 5 / 8 });
    expect(s.meanOffsetMs).toBeCloseTo(((0 + 10 - 130 + 130 + 20 - 10 + 10) / 7), 5);
    expect(s.meanAbsMs).toBeCloseTo((10 + 130 + 130 + 20 + 10 + 10) / 7, 5);
  });
  it("names the bar you rush in and the bar you drag in", () => {
    const s = run([-40, -30, -50, -20, 60, 70, 40, 50]);
    expect(s.rush).toMatchObject({ bar: 1, n: 4 });
    expect(s.rush!.mean).toBeCloseTo(-35);
    expect(s.drag).toMatchObject({ bar: 2 });
    expect(s.drag!.mean).toBeCloseTo(55);
  });
  it("names neither when bars average within the threshold, and survives an empty run", () => {
    const s = run([5, -5, 10, -10, 8, -8, RUSH_DRAG_MS - 1, 0]);
    expect(s.rush).toBeNull();
    expect(s.drag).toBeNull();
    const none = run([null, null, null, null, null, null, null, null]);
    expect(none).toMatchObject({ onTime: 0, missed: 8, onTimePct: 0, meanOffsetMs: 0 });
    expect(summarize(song, [], 0).onTimePct).toBe(0);
  });
});
