// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_REC_NOTES, finishRecorder, loadRecording, recordEvent, recordingMs, saveRecording, startRecorder } from "./pianoRecording";

const on = (note: number, time: number, velocity = 90) => ({ type: "on" as const, note, velocity, time });
const off = (note: number, time: number) => ({ type: "off" as const, note, velocity: 0, time });

describe("recording a run", () => {
  it("turns note-ons and note-offs into notes from the run's start", () => {
    const r = startRecorder(1000);
    recordEvent(r, on(60, 1100, 70));
    recordEvent(r, off(60, 1400));
    recordEvent(r, on(64, 1500, 200)); // velocity clamped
    recordEvent(r, on(64, 1700)); // struck again: the first note ends here
    recordEvent(r, off(99, 1800)); // never pressed: ignored
    recordEvent(r, on(67, 900)); // before the start counts as 0
    const notes = finishRecorder(r, 2000); // 64 and 67 still held
    expect(notes).toEqual([
      [100, 60, 70, 300],
      [500, 64, 127, 200],
      [700, 64, 90, 300],
      [0, 67, 90, 1000],
    ]);
    expect(recordingMs(notes)).toBe(1000);
  });
  it("stops adding notes past the limit", () => {
    const r = startRecorder(0);
    for (let i = 0; i < MAX_REC_NOTES + 5; i++) recordEvent(r, on(60, i));
    expect(finishRecorder(r, MAX_REC_NOTES + 10)).toHaveLength(MAX_REC_NOTES);
    const late = startRecorder(0);
    recordEvent(late, on(60, 31 * 60_000));
    expect(finishRecorder(late, 0)).toEqual([]);
  });
  it("keeps only the last run, on this device, and reads it back checked", () => {
    expect(loadRecording()).toBeNull();
    saveRecording({ songId: "a", title: "A", at: 5, notes: [] }); // nothing played: nothing saved
    expect(loadRecording()).toBeNull();
    saveRecording({ songId: "a", title: "A", at: 5, notes: [[0, 60, 80, 100]] });
    saveRecording({ songId: "b", title: "B", at: 6, notes: [[0, 62, 80, 100]] });
    expect(loadRecording("a")).toBeNull();
    expect(loadRecording("b")).toEqual({ songId: "b", title: "B", at: 6, notes: [[0, 62, 80, 100]] });
    expect(loadRecording()?.songId).toBe("b");
    localStorage.setItem("reel-radar-piano-last-run", JSON.stringify({ songId: "c", notes: [[0, 60, 80, 0], ["x"], [0, 300, 1, 5], [5, 60, 80, 10]] }));
    expect(loadRecording("c")).toEqual({ songId: "c", title: "", at: 0, notes: [[5, 60, 80, 10]] });
    localStorage.setItem("reel-radar-piano-last-run", JSON.stringify({ songId: "c", notes: [] }));
    expect(loadRecording()).toBeNull();
    localStorage.setItem("reel-radar-piano-last-run", JSON.stringify({ songId: 4, notes: [] }));
    expect(loadRecording()).toBeNull();
    localStorage.setItem("reel-radar-piano-last-run", "{bad");
    expect(loadRecording()).toBeNull();
  });
  it("survives storage that throws", () => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    try {
      expect(() => saveRecording({ songId: "a", title: "A", at: 1, notes: [[0, 60, 80, 10]] })).not.toThrow();
    } finally {
      Storage.prototype.setItem = set;
    }
  });
});
