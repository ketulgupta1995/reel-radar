// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIMING_DEFAULTS, loadLatencyMs, loadTiming, saveTiming } from "./pianoTimingSettings";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("timing settings", () => {
  it("starts with defaults and keeps each saved field", () => {
    expect(loadTiming()).toEqual(TIMING_DEFAULTS);
    saveTiming({ bpm: 120 });
    saveTiming({ latencyMs: 35 });
    expect(loadTiming()).toEqual({ bpm: 120, beatsPerBar: 4, latencyMs: 35 });
    expect(loadLatencyMs()).toBe(35);
  });

  it("repairs odd stored values", () => {
    localStorage.setItem("reel-radar-piano-timing", JSON.stringify({ bpm: 900, beatsPerBar: 7, latencyMs: "x" }));
    expect(loadTiming()).toEqual({ bpm: 200, beatsPerBar: 4, latencyMs: 0 });
    localStorage.setItem("reel-radar-piano-timing", "not json");
    expect(loadTiming()).toEqual(TIMING_DEFAULTS);
    localStorage.setItem("reel-radar-piano-timing", JSON.stringify({ latencyMs: 9999 }));
    expect(loadTiming().latencyMs).toBe(500);
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadTiming()).toEqual(TIMING_DEFAULTS);
    saveTiming({ bpm: 90 });
  });
});
