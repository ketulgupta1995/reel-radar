// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeAudio } from "@/test/audio";
import { createSynth, hertz, unlockAudio } from "./pianoSynth";

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

describe("click", () => {
  it("beeps higher on the accent, at the time asked for", () => {
    const voices = installFakeAudio();
    const s = createSynth();
    s.click(true);
    s.click(false, 250);
    expect(voices.map((v) => [v.hz, v.started, v.startAt])).toEqual([
      [1600, true, 0],
      [1000, true, 0.25],
    ]);
    s.click(false, -5);
    expect(voices[2].startAt).toBe(0);
  });

  it("does nothing without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    createSynth().click(true);
  });
});

describe("unlockAudio", () => {
  it("creates and resumes the shared context inside the tap; the synth reuses it until closed", () => {
    const voices = installFakeAudio();
    const Base = (window as unknown as { AudioContext: new () => { resume: () => Promise<void> } }).AudioContext;
    const made: { resume: ReturnType<typeof vi.fn> }[] = [];
    class Counting extends Base {
      constructor() {
        super();
        made.push(this as unknown as { resume: ReturnType<typeof vi.fn> });
      }
    }
    vi.stubGlobal("AudioContext", Counting);
    unlockAudio();
    expect(made).toHaveLength(1);
    expect(made[0].resume).toHaveBeenCalledTimes(1);
    const synth = createSynth();
    synth.noteOn(60, 90);
    synth.click(true);
    expect(made).toHaveLength(1);
    expect(voices).toHaveLength(2);
    synth.close();
    synth.noteOn(62, 90); // a closed context is replaced by a new one
    expect(made).toHaveLength(2);
  });

  it("does nothing where Web Audio is missing", () => {
    expect(() => unlockAudio()).not.toThrow();
  });
});
