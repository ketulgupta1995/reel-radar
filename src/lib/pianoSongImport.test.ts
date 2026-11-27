import { describe, expect, it } from "vitest";
import { ParsedMidi, ParsedNote } from "./pianoMidiFile";
import { DEFAULT_SPLIT, barsOf, buildImportedSong, cleanTitle, decodeSong, encodeSong, handCounts, planHands } from "./pianoSongImport";

const n = (pitch: number, start: number, track = 0, channel = 0, dur = 1): ParsedNote => ({ start, dur, pitch, track, channel });
const midi = (notes: ParsedNote[], extra: Partial<ParsedMidi> = {}): ParsedMidi => ({ format: 1, bpm: 100, beatsPerBar: 4, notes, ...extra });
const ID = "0123456789ab";

describe("planHands", () => {
  it("takes two note-bearing tracks as the hands, the higher average being the right", () => {
    const p = planHands(midi([n(72, 0, 1), n(74, 1, 1), n(48, 0, 2), n(50, 1, 2)]));
    expect(p.by).toBe("tracks");
    expect(p.hands).toEqual(["R", "R", "L", "L"]);
    expect(planHands(midi([n(40, 0, 3), n(72, 0, 5)])).hands).toEqual(["L", "R"]); // track numbers don't matter
  });
  it("takes two channels of one track the same way", () => {
    const p = planHands(midi([n(48, 0, 0, 1), n(76, 0, 0, 0), n(50, 1, 0, 1)]));
    expect(p.by).toBe("channels");
    expect(p.hands).toEqual(["L", "R", "L"]);
  });
  it("splits one part at the split point (default middle C; at or above is right)", () => {
    const notes = [n(59, 0), n(60, 1), n(72, 2)];
    expect(planHands(midi(notes)).by).toBe("split");
    expect(planHands(midi(notes)).hands).toEqual(["L", "R", "R"]);
    expect(planHands(midi(notes), 72).hands).toEqual(["L", "L", "R"]);
    expect(DEFAULT_SPLIT).toBe(60);
  });
  it("splits when there are three tracks, or one track on three channels", () => {
    expect(planHands(midi([n(60, 0, 1), n(60, 1, 2), n(60, 2, 3)])).by).toBe("split");
    expect(planHands(midi([n(60, 0, 0, 0), n(61, 1, 0, 1), n(62, 2, 0, 2)])).by).toBe("split");
  });
  it("counts hands and bars", () => {
    expect(handCounts(["R", "L", "R"])).toEqual({ R: 2, L: 1 });
    expect(barsOf([n(60, 0), n(60, 7, 0, 0, 1)], 4)).toBe(2);
    expect(barsOf([n(60, 0, 0, 0, 4)], 4)).toBe(1);
    expect(barsOf([n(60, 0, 0, 0, 4.25)], 4)).toBe(2);
    expect(barsOf([], 4)).toBe(1);
  });
});

describe("buildImportedSong and the stored doc", () => {
  const parsed = midi([n(72, 0), n(74, 1), n(48, 0, 0, 0, 2), n(52, 0, 0, 0, 2), n(55, 0, 0, 0, 2)]);
  const song = buildImportedSong(parsed, planHands(parsed), ID, "  Tune\u0000  ");
  it("builds a song: imported, level 0, every note suggested, fingers from the suggester", () => {
    expect(song).toMatchObject({ id: ID, title: "Tune", bpm: 100, beatsPerBar: 4, level: 0, imported: true });
    expect(song.notes.every((x) => x.suggested)).toBe(true);
    expect(song.notes.filter((x) => x.hand === "L").map((x) => x.finger)).toEqual([5, 3, 1]);
    expect(song.notes.filter((x) => x.hand === "R").map((x) => x.pitch)).toEqual([72, 74]);
  });
  it("falls back to a title when it is blank", () => {
    expect(buildImportedSong(parsed, planHands(parsed), ID, "  ").title).toBe("Imported song");
    expect(cleanTitle(5)).toBe("");
  });
  it("round-trips through the compact doc, and the doc is small", () => {
    const doc = encodeSong(song, 60);
    expect(doc.split).toBe(60);
    expect(decodeSong(JSON.parse(JSON.stringify(doc)), ID)).toEqual(song);
    expect(encodeSong(song).split).toBeUndefined();
    const big = { ...song, notes: Array.from({ length: 5000 }, (_, i) => ({ start: i * 0.25, dur: 0.25, pitch: 60, hand: "R" as const, finger: 3, suggested: true })) };
    expect(JSON.stringify(encodeSong(big)).length).toBeLessThan(200 * 1024);
  });
  it("refuses anything that isn't a well-formed song doc", () => {
    const ok = JSON.parse(JSON.stringify(encodeSong(song)));
    expect(decodeSong(ok, ID)).toBeDefined();
    const bad = (mut: (d: Record<string, unknown>) => void) => {
      const d = JSON.parse(JSON.stringify(ok));
      mut(d);
      return decodeSong(d, ID);
    };
    expect(decodeSong(null, ID)).toBeUndefined();
    expect(decodeSong("x", ID)).toBeUndefined();
    expect(decodeSong(ok, "ffffffffffff")).toBeUndefined(); // id mismatch
    expect(decodeSong({ ...ok, id: "../x" }, "../x")).toBeUndefined();
    expect(bad((d) => (d.v = 2))).toBeUndefined();
    expect(bad((d) => (d.title = ""))).toBeUndefined();
    expect(bad((d) => (d.bpm = 5))).toBeUndefined();
    expect(bad((d) => (d.beatsPerBar = 0))).toBeUndefined();
    expect(bad((d) => (d.notes = []))).toBeUndefined();
    expect(bad((d) => (d.notes = "x"))).toBeUndefined();
    expect(bad((d) => (d.notes = new Array(5001).fill([0, 1, 60, 1, 1])))).toBeUndefined();
    for (const row of [[0, 1, 60, 1], [-1, 1, 60, 1, 1], [0, 0, 60, 1, 1], [0, 1, 128, 1, 1], [0, 1, 60.5, 1, 1], [0, 1, 60, 2, 1], [0, 1, 60, 1, 6], [0, 1, 60, 1, 2.5], ["0", 1, 60, 1, 1], "x", [0, 1, 60, 1, NaN]]) {
      expect(bad((d) => (d.notes = [row]))).toBeUndefined();
    }
  });
});
