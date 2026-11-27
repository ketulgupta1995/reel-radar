// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { INITIAL, NoteEvent, createPianoMidi, isBlack, noteName, noteOctave } from "./pianoMidi";
import type { Synth } from "./pianoSynth";

afterEach(() => {
  uninstallMidi();
  vi.useRealTimers();
});

const synth = () => ({ noteOn: vi.fn(), noteOff: vi.fn(), close: vi.fn() }) satisfies Synth;
const record = (m: ReturnType<typeof createPianoMidi>) => {
  const events: NoteEvent[] = [];
  m.onNote((e) => events.push(e));
  return events;
};

describe("note names", () => {
  it("names MIDI notes with sharps and the octave where 60 is C4", () => {
    expect(noteName(61)).toBe("C#");
    expect(noteOctave(60)).toBe(4);
    expect(isBlack(61)).toBe(true);
    expect(isBlack(62)).toBe(false);
  });
});

describe("connection state", () => {
  it("is unsupported without Web MIDI", async () => {
    const m = createPianoMidi({ synth: synth() });
    expect(m.getSnapshot()).toBe(INITIAL);
    await m.start();
    expect(m.getSnapshot().state).toBe("unsupported");
  });

  it("is denied when permission is refused", async () => {
    fakeMidi().install({ deny: true });
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    expect(m.getSnapshot().state).toBe("denied");
  });

  it("asks without SysEx and starts only once", async () => {
    const midi = fakeMidi().install();
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    await m.start();
    expect(midi.request).toHaveBeenCalledTimes(1);
    expect(midi.request).toHaveBeenCalledWith({ sysex: false });
    expect(m.getSnapshot().state).toBe("disconnected");
  });

  it("connects to a device that is already plugged in, and follows unplug and replug", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug();
    const m = createPianoMidi({ synth: synth() });
    const seen = vi.fn();
    m.subscribe(seen);
    await m.start();
    expect(m.getSnapshot()).toMatchObject({ state: "connected", deviceId: "CASIO USB-MIDI" });
    midi.unplug();
    expect(m.getSnapshot()).toMatchObject({ state: "disconnected", devices: [], deviceId: null });
    midi.plug();
    expect(m.getSnapshot().state).toBe("connected");
    expect(seen).toHaveBeenCalled();
  });

  it("lists several devices and lets one be chosen, falling back when it goes", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug("A", "a");
    midi.plug("B", "b");
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    expect(m.getSnapshot().deviceId).toBe("a");
    expect(m.getSnapshot().devices.map((d) => d.name)).toEqual(["A", "B"]);
    m.selectDevice("b");
    expect(m.getSnapshot().deviceId).toBe("b");
    const events = record(m);
    midi.noteOn(60, 100, 1, "a"); // the unselected device is ignored
    midi.noteOn(62, 100, 2, "b");
    expect(events.map((e) => e.note)).toEqual([62]);
    midi.unplug("b");
    expect(m.getSnapshot().deviceId).toBe("a");
  });

  it("names an unnamed device", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug("", "x");
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    expect(m.getSnapshot().devices[0].name).toBe("MIDI device");
  });
});

describe("note events", () => {
  async function connected() {
    const midi = fakeMidi();
    midi.install();
    midi.plug();
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    return { midi, m };
  }

  it("passes note-on and note-off with the device's own timestamps", async () => {
    const { midi, m } = await connected();
    const events = record(m);
    midi.noteOn(61, 80, 1234.5);
    midi.noteOff(61, 1500);
    midi.raw([0x90, 62, 0], 1600); // note-on with velocity 0 is a note-off
    expect(events).toEqual([
      { type: "on", note: 61, velocity: 80, time: 1234.5, source: "keyboard" },
      { type: "off", note: 61, velocity: 0, time: 1500, source: "keyboard" },
      { type: "off", note: 62, velocity: 0, time: 1600, source: "keyboard" },
    ]);
  });

  it("ignores clock, bend and short messages", async () => {
    const { midi, m } = await connected();
    const events = record(m);
    midi.raw([0xf8]);
    midi.raw([0xe0, 0, 64]);
    midi.raw([0x90, 60]);
    expect(events).toEqual([]);
    const input = midi.access.inputs.get("CASIO USB-MIDI")!;
    input.onmidimessage!({ data: null, timeStamp: 0 });
    expect(events).toEqual([]);
  });

  it("releases held keys when the cable is pulled, and stops listening after unsubscribe", async () => {
    const { midi, m } = await connected();
    const events = record(m);
    const off = m.onNote(() => {
      throw new Error("unsubscribed listener called");
    });
    off();
    midi.noteOn(60);
    midi.unplug();
    expect(events.map((e) => [e.type, e.note])).toEqual([["on", 60], ["off", 60]]);
  });

  it("gives screen presses the same events", async () => {
    const m = createPianoMidi({ synth: synth() });
    const events = record(m);
    m.noteOn(64);
    m.noteOff(64);
    expect(events.map((e) => [e.type, e.note, e.source])).toEqual([["on", 64, "screen"], ["off", 64, "screen"]]);
    expect(events[0].velocity).toBeGreaterThan(0);
  });
});

describe("sound", () => {
  it("plays on-screen notes through the keyboard when connected, not the synth", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug();
    const s = synth();
    const m = createPianoMidi({ synth: s });
    await m.start();
    m.noteOn(60, 100);
    m.noteOff(60);
    expect(midi.sent()).toEqual([[0x90, 60, 100], [0x80, 60, 0]]);
    expect(s.noteOn).not.toHaveBeenCalled();
  });

  it("falls back to the synth when no keyboard is connected", async () => {
    const midi = fakeMidi();
    midi.install();
    const s = synth();
    const m = createPianoMidi({ synth: s });
    await m.start();
    m.noteOn(60, 100);
    m.noteOff(60);
    expect(s.noteOn).toHaveBeenCalledWith(60, 100);
    expect(s.noteOff).toHaveBeenCalledWith(60);
    expect(midi.sent()).toEqual([]);
  });

  it("play() sounds a note for its duration", async () => {
    vi.useFakeTimers();
    const midi = fakeMidi();
    midi.install();
    midi.plug();
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    m.play(67, 90, 500);
    expect(midi.sent()).toEqual([[0x90, 67, 90]]);
    vi.advanceTimersByTime(500);
    expect(midi.sent()).toEqual([[0x90, 67, 90], [0x80, 67, 0]]);
  });

  it("uses any output when none matches the input's name", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug("In", "in");
    midi.access.outputs.set("o", { id: "o", name: "Other", state: "connected", sent: [], send(d) { this.sent.push([...d]); } });
    midi.access.outputs.delete("in");
    const m = createPianoMidi({ synth: synth() });
    await m.start();
    m.noteOn(60, 100);
    expect(midi.access.outputs.get("o")!.sent).toEqual([[0x90, 60, 100]]);
  });

  it("uses the synth when the keyboard has no output port", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug("In", "in");
    midi.access.outputs.clear();
    const s = synth();
    const m = createPianoMidi({ synth: s });
    await m.start();
    m.noteOn(60, 100);
    expect(s.noteOn).toHaveBeenCalled();
  });
});

describe("stop", () => {
  it("detaches from the device and closes the synth", async () => {
    const midi = fakeMidi();
    midi.install();
    midi.plug();
    const s = synth();
    const m = createPianoMidi({ synth: s });
    await m.start();
    const events = record(m);
    m.stop();
    midi.noteOn(60);
    expect(events).toEqual([]);
    expect(midi.access.onstatechange).toBeNull();
    expect(s.close).toHaveBeenCalled();
  });

  it("ignores access that arrives after stop, or a refusal after stop", async () => {
    const midi = fakeMidi();
    midi.install();
    const m = createPianoMidi({ synth: synth() });
    const p = m.start();
    m.stop();
    await p;
    expect(m.getSnapshot()).toBe(INITIAL);
    expect(midi.access.onstatechange).toBeNull();

    const denied = fakeMidi().install({ deny: true });
    const m2 = createPianoMidi({ synth: synth() });
    const p2 = m2.start();
    m2.stop();
    await p2;
    expect(m2.getSnapshot()).toBe(INITIAL);
    expect(denied.request).toHaveBeenCalled();
  });
});
