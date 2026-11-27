// A small Web Audio synth for when no keyboard is connected. The AudioContext is created on the first
// note (a tap), because browsers only allow sound after a user gesture.
export type Synth = {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  // A short click (accent: higher and louder), starting delayMs from now (default at once).
  click(accent: boolean, delayMs?: number): void;
  close(): void;
};

type AudioCtor = typeof AudioContext;

export const CLICK_HZ = { accent: 1600, beat: 1000 };
export const hertz = (note: number) => 440 * 2 ** ((note - 69) / 12);

// One AudioContext for the page, so a tap that calls unlockAudio() unlocks the synth's sound too.
let shared: { ctx: AudioContext; made: AudioCtor } | null = null;
function sharedContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!shared || shared.made !== Ctor) shared = { ctx: new Ctor(), made: Ctor };
  return shared.ctx;
}

// Create and resume the shared AudioContext. Call it inside a user tap (Start practice), before sound is needed.
export function unlockAudio() {
  void sharedContext()?.resume?.();
}

export function createSynth(): Synth {
  let ctx: AudioContext | null = null;
  const live = new Map<number, { osc: OscillatorNode; gain: GainNode }>();

  function context() {
    ctx = sharedContext();
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
    click(accent, delayMs = 0) {
      const c = context();
      if (!c) return;
      void c.resume?.();
      const t = c.currentTime + Math.max(0, delayMs) / 1000;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "square";
      osc.frequency.value = accent ? CLICK_HZ.accent : CLICK_HZ.beat;
      gain.gain.setValueAtTime(accent ? 0.35 : 0.22, t);
      gain.gain.setTargetAtTime(0, t + 0.005, 0.01);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    },
    close() {
      for (const n of [...live.keys()]) release(n);
      if (ctx) {
        void ctx.close?.();
        if (shared?.ctx === ctx) shared = null;
      }
      ctx = null;
    },
  };
}
