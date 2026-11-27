import { vi } from "vitest";

// A fake AudioContext that records the notes the synth starts and stops.
export type FakeVoice = { hz: number; started: boolean; stopped: boolean; startAt?: number };

export function installFakeAudio() {
  const voices: FakeVoice[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createGain() {
      return { gain: param(), connect: vi.fn() };
    }
    createOscillator() {
      const voice: FakeVoice = { hz: 0, started: false, stopped: false };
      voices.push(voice);
      return {
        type: "sine",
        frequency: {
          set value(v: number) {
            voice.hz = v;
          },
        },
        connect: vi.fn(),
        start: (t?: number) => {
          voice.started = true;
          voice.startAt = t;
        },
        stop: () => void (voice.stopped = true),
      };
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return voices;
}
