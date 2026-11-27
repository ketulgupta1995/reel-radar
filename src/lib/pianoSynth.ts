// A small Web Audio synth for when no keyboard is connected. The AudioContext is created on the first
// note (a tap), because browsers only allow sound after a user gesture.
export type Synth = {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  close(): void;
};

type AudioCtor = typeof AudioContext;

export const hertz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export function createSynth(): Synth {
  let ctx: AudioContext | null = null;
  const live = new Map<number, { osc: OscillatorNode; gain: GainNode }>();

  function context() {
    if (ctx) return ctx;
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  function release(note: number) {
    const v = live.get(note);
    if (!v || !ctx) return;
    live.delete(note);
    const t = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, 0.08);
    v.osc.stop(t + 0.6);
  }

  return {
    noteOn(note, velocity) {
      const c = context();
      if (!c) return;
      void c.resume?.();
      release(note);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.value = hertz(note);
      const t = c.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime((Math.max(1, Math.min(127, velocity)) / 127) * 0.3, t + 0.01);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      live.set(note, { osc, gain });
    },
    noteOff: release,
    close() {
      for (const n of [...live.keys()]) release(n);
      void ctx?.close?.();
      ctx = null;
    },
  };
}
