// The one module that owns Web MIDI for Piano. The UI never touches navigator.requestMIDIAccess: it
// reads a snapshot (connection state, devices), subscribes to note events, and asks it to play notes.
// With a keyboard connected, app-made sound goes out to it; otherwise a small Web Audio synth plays.
import { Synth, createSynth } from "./pianoSynth";

export type MidiState = "unsupported" | "denied" | "disconnected" | "connected";
export type MidiDevice = { id: string; name: string };
export type MidiSnapshot = { state: MidiState; devices: MidiDevice[]; deviceId: string | null };
// time is in milliseconds on the performance.now() clock (a real keyboard's own event timestamp, so
// timing scores don't pick up handler jitter).
export type NoteEvent = { type: "on" | "off"; note: number; velocity: number; time: number; source: "keyboard" | "screen" };

export type PianoMidi = {
  getSnapshot(): MidiSnapshot;
  subscribe(listener: () => void): () => void;
  onNote(listener: (e: NoteEvent) => void): () => void;
  start(): Promise<void>;
  stop(): void;
  selectDevice(id: string): void;
  // A key pressed on the on-screen keyboard: emits a note event and sounds it.
  noteOn(note: number, velocity?: number): void;
  noteOff(note: number): void;
  // App-made note (hints, songs): sounds only, no event. `at` is a time on the performance.now() clock:
  // the keyboard gets note-on at `at` and note-off at `at + durationMs` as MIDI timestamps; the synth is
  // started by a timer.
  play(note: number, velocity: number, durationMs: number, at?: number): void;
  // A metronome click. `at` is a time on the performance.now() clock (default: now): the keyboard
  // gets it as the MIDI timestamp, the fallback click is scheduled on the audio clock to match.
  click(accent: boolean, at?: number): void;
};

export const INITIAL: MidiSnapshot = { state: "disconnected", devices: [], deviceId: null };

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (note: number) => NAMES[((note % 12) + 12) % 12];
export const noteOctave = (note: number) => Math.floor(note / 12) - 1; // 60 = C4
export const isBlack = (note: number) => noteName(note).includes("#");

const SCREEN_VELOCITY = 90;
// The click is a General MIDI percussion hit on channel 10 (status 0x99): Hi Wood Block (76) on the
// accented beat, Low Wood Block (77) on the others. They are short one-shots, so no note-off is sent.
export const CLICK = { status: 0x99, accent: { note: 76, velocity: 120 }, beat: { note: 77, velocity: 95 } };

export function createPianoMidi(opts: { synth?: Synth } = {}): PianoMidi {
  const synth = opts.synth ?? createSynth();
  let snapshot = INITIAL;
  let access: MIDIAccess | null = null;
  let chosen: string | null = null;
  let started = false;
  let stopped = false;
  const listeners = new Set<() => void>();
  const noteListeners = new Set<(e: NoteEvent) => void>();
  const held = new Set<number>(); // notes down on the real keyboard

  const set = (next: MidiSnapshot) => {
    snapshot = next;
    listeners.forEach((l) => l());
  };
  const emit = (e: NoteEvent) => noteListeners.forEach((l) => l(e));
  const now = () => performance.now();

  function output(): MIDIOutput | null {
    if (!access || snapshot.state !== "connected") return null;
    const input = [...access.inputs.values()].find((i) => i.id === snapshot.deviceId);
    const outs = [...access.outputs.values()].filter((o) => o.state === "connected");
    return outs.find((o) => o.name === input?.name) ?? outs[0] ?? null;
  }

  function sound(on: boolean, note: number, velocity: number) {
    const out = output();
    if (out) out.send([on ? 0x90 : 0x80, note, on ? velocity : 0]);
    else if (on) synth.noteOn(note, velocity);
    else synth.noteOff(note);
  }

  function click(accent: boolean, at?: number) {
    const out = output();
    const c = accent ? CLICK.accent : CLICK.beat;
    if (out) {
      if (at === undefined) out.send([CLICK.status, c.note, c.velocity]);
      else out.send([CLICK.status, c.note, c.velocity], at);
    } else synth.click(accent, at === undefined ? 0 : at - now());
  }

  function onMessage(e: MIDIMessageEvent) {
    const d = e.data;
    if (!d || d.length < 3) return;
    const kind = d[0] & 0xf0;
    if (kind !== 0x90 && kind !== 0x80) return;
    const on = kind === 0x90 && d[2] > 0;
    if (on) held.add(d[1]);
    else held.delete(d[1]);
    emit({ type: on ? "on" : "off", note: d[1], velocity: on ? d[2] : 0, time: e.timeStamp, source: "keyboard" });
  }

  // A keyboard that goes away mid-note would leave its keys lit; release them.
  function releaseHeld() {
    for (const note of [...held]) emit({ type: "off", note, velocity: 0, time: now(), source: "keyboard" });
    held.clear();
  }

  function refresh() {
    if (!access) return;
    const inputs = [...access.inputs.values()].filter((i) => i.state === "connected");
    const devices = inputs.map((i) => ({ id: i.id, name: i.name || "MIDI device" }));
    const pick = devices.find((d) => d.id === chosen) ?? devices[0] ?? null;
    if (pick?.id !== snapshot.deviceId) releaseHeld();
    for (const i of access.inputs.values()) i.onmidimessage = pick && i.id === pick.id && i.state === "connected" ? onMessage : null;
    set({ state: pick ? "connected" : "disconnected", devices, deviceId: pick?.id ?? null });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    onNote(l) {
      noteListeners.add(l);
      return () => void noteListeners.delete(l);
    },
    async start() {
      if (started) return;
      started = true;
      stopped = false;
      if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") {
        set({ ...INITIAL, state: "unsupported" });
        return;
      }
      let got: MIDIAccess;
      try {
        got = await navigator.requestMIDIAccess({ sysex: false });
      } catch {
        if (!stopped) set({ ...INITIAL, state: "denied" });
        return;
      }
      if (stopped) return;
      access = got;
      access.onstatechange = refresh; // hot-plug: unplug, replug, a second device
      refresh();
    },
    stop() {
      stopped = true;
      started = false;
      if (access) {
        access.onstatechange = null;
        for (const i of access.inputs.values()) i.onmidimessage = null;
      }
      access = null;
      releaseHeld();
      synth.close();
    },
    selectDevice(id) {
      chosen = id;
      refresh();
    },
    noteOn(note, velocity = SCREEN_VELOCITY) {
      sound(true, note, velocity);
      emit({ type: "on", note, velocity, time: now(), source: "screen" });
    },
    noteOff(note) {
      sound(false, note, 0);
      emit({ type: "off", note, velocity: 0, time: now(), source: "screen" });
    },
    click,
    play(note, velocity, durationMs, at) {
      const out = output();
      if (out && at !== undefined) {
        out.send([0x90, note, velocity], at);
        out.send([0x80, note, 0], at + durationMs);
        return;
      }
      const go = () => {
        sound(true, note, velocity);
        setTimeout(() => sound(false, note, 0), durationMs);
      };
      const wait = at === undefined ? 0 : at - now();
      if (wait > 0) setTimeout(go, wait);
      else go();
    },
  };
}
