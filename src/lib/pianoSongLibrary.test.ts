import { describe, expect, it } from "vitest";
import { SONGS, SONG_DEFS, songById } from "./pianoSongLibrary";
import { handOf, parseHand, songRange, stepsOf } from "./pianoSongs";

// Pitch sequences of the melodies (right hand), checked against published letter notes.
const MELODY = (id: string) =>
  handOf(songById(id)!.notes, "R")
    .map((n) => n.pitch)
    .join(",");
const names = (s: string) =>
  s
    .split(" ")
    .map((x) => {
      const m = /^([A-G])(#?)(\d)$/.exec(x)!;
      return (Number(m[3]) + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"] + (m[2] ? 1 : 0);
    })
    .join(",");

describe("built-in songs", () => {
  it("has twelve songs with unique ids, levels from easiest up", () => {
    expect(SONGS).toHaveLength(12);
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(12);
    expect(songById("ode-to-joy")?.title).toBe("Ode to Joy");
    expect(songById("nope")).toBeUndefined();
    const levels = SONGS.map((s) => s.level);
    expect(levels[0]).toBe(1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(5);
  });

  for (const song of SONGS) {
    describe(song.title, () => {
      it("has fingers 1-5, positive lengths, ascending steps and both hands", () => {
        for (const n of song.notes) {
          expect(n.finger).toBeGreaterThanOrEqual(1);
          expect(n.finger).toBeLessThanOrEqual(5);
          expect(n.dur).toBeGreaterThan(0);
          expect(n.suggested).toBeUndefined(); // hand-written fingering
        }
        const starts = stepsOf(song).map((s) => s.start);
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
        expect(new Set(starts).size).toBe(starts.length);
        expect(handOf(song.notes, "R").length).toBeGreaterThan(8);
        expect(handOf(song.notes, "L").length).toBeGreaterThan(4);
      });
      it("keeps the keys to scroll within four octaves and the right hand above the left's lowest note", () => {
        const { low, high } = songRange(song);
        expect(high - low).toBeLessThanOrEqual(48); // at most four octaves to scroll on a phone
        expect(Math.min(...handOf(song.notes, "L").map((n) => n.pitch))).toBeLessThan(Math.max(...handOf(song.notes, "R").map((n) => n.pitch)));
      });
      it("never lets a hand's notes overlap itself except in chords", () => {
        for (const hand of ["R", "L"] as const) {
          const ns = handOf(song.notes, hand);
          for (const a of ns) for (const b of ns) if (a !== b && a.start < b.start) expect(a.start + a.dur).toBeLessThanOrEqual(b.start + 1e-9);
        }
      });
    });
  }

  it("fills every bar in both hands: bars add up to beats per bar, after an optional pickup", () => {
    for (const d of SONG_DEFS) {
      const r = parseHand(d.rh, "R").bars;
      const l = parseHand(d.lh, "L").bars;
      expect(l, d.title).toEqual(r); // the hands line up bar for bar
      expect(r[0], d.title).toBeLessThanOrEqual(d.beatsPerBar);
      for (const bar of r.slice(1)) expect(bar, d.title).toBe(d.beatsPerBar);
    }
  });

  it("plays the well-known melodies", () => {
    expect(MELODY("mary-had-a-little-lamb")).toBe(names("E4 D4 C4 D4 E4 E4 E4 D4 D4 D4 E4 G4 G4 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4"));
    expect(MELODY("twinkle-twinkle")).toBe(
      names("C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4 G4 G4 F4 F4 E4 E4 D4 G4 G4 F4 F4 E4 E4 D4 C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4"),
    );
    expect(MELODY("ode-to-joy").split(",").slice(0, 15).join(",")).toBe(names("E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4"));
    expect(MELODY("frere-jacques").split(",").slice(0, 12).join(",")).toBe(names("C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4 E4"));
    expect(MELODY("jingle-bells")).toBe(names("E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4 F4 F4 F4 F4 F4 E4 E4 E4 E4 E4 D4 D4 E4 D4 G4"));
    expect(MELODY("when-the-saints")).toBe(names("C4 E4 F4 G4 C4 E4 F4 G4 C4 E4 F4 G4 E4 C4 E4 D4 E4 E4 D4 C4 E4 G4 G4 F4 E4 F4 G4 E4 C4 D4 C4"));
    expect(MELODY("happy-birthday")).toBe(
      names("G4 G4 A4 G4 C5 B4 G4 G4 A4 G4 D5 C5 G4 G4 G5 E5 C5 B4 A4 F5 F5 E5 C5 D5 C5"),
    );
    expect(MELODY("amazing-grace")).toBe(names("D4 G4 B4 G4 B4 A4 G4 E4 D4 D4 G4 B4 G4 B4 A4 D5 B4 D5 B4 G4 E4 G4 E4 D4 D4 G4 B4 G4 B4 A4 G4"));
    expect(MELODY("minuet-in-g").split(",").slice(0, 16).join(",")).toBe(names("D5 G4 A4 B4 C5 D5 G4 G4 E5 C5 D5 E5 F#5 G5 G4 G4"));
    expect(MELODY("fur-elise").split(",").slice(0, 9).join(",")).toBe(names("E5 D#5 E5 D#5 E5 B4 D5 C5 A4"));
    expect(MELODY("greensleeves").split(",").slice(0, 9).join(",")).toBe(names("A4 C5 D5 E5 F5 E5 D5 B4 G4"));
  });

  it("keeps the keys to the beginner-friendly ones", () => {
    const keys = Object.fromEntries(SONGS.map((s) => [s.id, s.key]));
    expect(keys["minuet-in-g"]).toBe("G");
    expect(keys["fur-elise"]).toBe("A minor");
    expect(keys["amazing-grace"]).toBe("G");
    for (const id of ["mary-had-a-little-lamb", "twinkle-twinkle", "ode-to-joy", "happy-birthday", "canon"]) expect(keys[id]).toBe("C");
  });

  it("gives the left hand roots first, then 5-3-1 triads", () => {
    for (const id of ["happy-birthday", "minuet-in-g", "canon"]) {
      const chords = stepsOf(songById(id)!).flatMap((s) => [handOf(s.notes, "L")]).filter((c) => c.length);
      for (const c of chords) expect(c.map((n) => n.finger)).toEqual([5, 3, 1]);
    }
    expect(handOf(songById("mary-had-a-little-lamb")!.notes, "L").every((n) => n.finger === 5)).toBe(true);
  });
});
