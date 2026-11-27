// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeAudio } from "@/test/audio";
import { createSynth, hertz } from "./pianoSynth";

afterEach(() => vi.unstubAllGlobals());

describe("synth", () => {
  it("tunes A4 to 440 Hz", () => {
    expect(hertz(69)).toBe(440);
    expect(hertz(81)).toBeCloseTo(880);
  });

  it("starts a tone on note-on and stops it on note-off", () => {
    const voices = installFakeAudio();
    const s = createSynth();
    s.noteOn(69, 100);
    expect(voices).toHaveLength(1);
    expect(voices[0]).toMatchObject({ hz: 440, started: true, stopped: false });
    s.noteOff(69);
    expect(voices[0].stopped).toBe(true);
    s.noteOff(69); // nothing left to stop
  });

  it("restarts a note that is struck again and silences everything on close", () => {
    const voices = installFakeAudio();
    const s = createSynth();
    s.noteOn(60, 0);
    s.noteOn(60, 200);
    expect(voices.map((v) => v.stopped)).toEqual([true, false]);
    s.close();
    expect(voices[1].stopped).toBe(true);
    s.noteOff(60);
  });

  it("makes no sound where Web Audio is missing", () => {
    const s = createSynth();
    expect(() => s.noteOn(60, 90)).not.toThrow();
    s.noteOff(60);
    s.close();
  });

  it("falls back to the prefixed constructor", () => {
    const voices = installFakeAudio();
    const Ctor = (window as unknown as { AudioContext: unknown }).AudioContext;
    vi.stubGlobal("AudioContext", undefined);
    (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = Ctor;
    createSynth().noteOn(60, 90);
    expect(voices).toHaveLength(1);
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  });
});
