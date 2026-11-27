// The note-speed view (pure): how fast each of the twelve pitch classes was found, from the note drill's per-item
// Stats (statsFrom). Item ids are pitch-class names as noteName() gives them (C, C#, D ...). Only the note drill's
// items map to keys this way; chords and positions don't, so their results skip the keyboard.
import { SessionRecord, Stats, statsFrom } from "./pianoDrill";
import { noteName } from "./pianoMidi";

export type SpeedBand = "fast" | "ok" | "slow" | "none"; // none = no data
export type KeySpeed = {
  pc: number; // 0 = C .. 11 = B
  name: string;
  avgMs: number | null; // mean reaction over correct first answers that carry ms; null = unknown
  band: SpeedBand;
  attempts: number;
};
export type NoteSpeed = { keys: KeySpeed[]; slow: string[] }; // slow: names of the slow keys, slowest first

export const FAST_MS = 1000; // under this: fast
export const SLOW_MS = 2000; // over this: slow (1 s up to and including 2 s is ok)
export const SLOW_MISS_RATE = 0.3; // a key missed on at least this share of first answers is slow whatever its time

export function noteSpeed(stats: Readonly<Record<string, Stats>>): NoteSpeed {
  const keys: KeySpeed[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const name = noteName(pc);
    const s = stats[name];
    const attempts = s?.attempts ?? 0;
    const avgMs = s && s.ms !== undefined && s.msN ? s.ms / s.msN : null;
    const missy = attempts > 0 && (s?.misses ?? 0) / attempts >= SLOW_MISS_RATE;
    let band: SpeedBand = "none";
    if (missy || (avgMs !== null && avgMs > SLOW_MS)) band = "slow";
    else if (avgMs !== null) band = avgMs < FAST_MS ? "fast" : "ok";
    keys.push({ pc, name, avgMs, band, attempts });
  }
  const slow = keys
    .filter((k) => k.band === "slow")
    .sort((a, b) => (b.avgMs ?? Infinity) - (a.avgMs ?? Infinity) || a.pc - b.pc)
    .map((k) => k.name);
  return { keys, slow };
}

// The keyboard for the results screen: the note drill's rounds started since local midnight of `now` (a single round
// and a session both show today's picture). Pass recent records, e.g. recentSessions(now, 2).
export function todayNoteSpeed(records: readonly SessionRecord[], now: number): NoteSpeed {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return noteSpeed(statsFrom(records.filter((r) => r.startedAt >= midnight.getTime()), "notes"));
}
