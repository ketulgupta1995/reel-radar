"use client";

// Metronome settings, kept per device in localStorage (`reel-radar-piano-timing`). Not synced: the
// latency offset is specific to this phone or laptop, and the last tempo is a convenience that isn't
// worth a settings-doc write. Never throws when storage is blocked.
import { clampBpm } from "./pianoTiming";

const KEY = "reel-radar-piano-timing";
export type TimingSettings = { bpm: number; beatsPerBar: number; latencyMs: number };
export const TIMING_DEFAULTS: TimingSettings = { bpm: 80, beatsPerBar: 4, latencyMs: 0 };

export function loadTiming(): TimingSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<TimingSettings>;
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    return {
      bpm: clampBpm(num(raw.bpm, TIMING_DEFAULTS.bpm)),
      beatsPerBar: [2, 3, 4].includes(raw.beatsPerBar as number) ? (raw.beatsPerBar as number) : TIMING_DEFAULTS.beatsPerBar,
      latencyMs: Math.max(-500, Math.min(500, num(raw.latencyMs, 0))),
    };
  } catch {
    return TIMING_DEFAULTS;
  }
}

export function saveTiming(patch: Partial<TimingSettings>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadTiming(), ...patch }));
  } catch {
    // Storage blocked: the settings last until the page closes.
  }
}

// Just the device's latency, for drills that score hits (rhythm, play-along, scales).
export const loadLatencyMs = () => loadTiming().latencyMs;
