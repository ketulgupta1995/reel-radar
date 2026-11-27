// Milestones (pure): small goals that reward daily practice. Each is checked against the practice history and the
// settings; once reached it is kept in piano-settings `milestones` {[id]: when first reached} (pianoData,
// saveMilestones; merged as a union keeping the earliest time), so a streak milestone stays earned after a break.
import type { PianoSettings } from "./pianoData";
import { SessionRecord, statsFrom } from "./pianoDrill";
import { streak } from "./pianoLog";
import { noteSpeed } from "./pianoNoteSpeed";

export type Milestone = { id: string; title: string; text: string };
export const SPEED_DAYS = 30; // the note-speed milestones read the last 30 days of the note drill
const NATURALS = ["C", "D", "E", "F", "G", "A", "B"];

export const MILESTONES: readonly Milestone[] = [
  { id: "first-step", title: "First song step", text: "Finish a step of a song's hands ladder" },
  { id: "first-song", title: "First song mastered", text: "Both hands at full tempo, 90% on time" },
  { id: "five-songs", title: "Five songs mastered", text: "Five songs at full tempo" },
  { id: "naturals-1s", title: "All naturals under 1 s", text: "Find C D E F G A B in under a second each" },
  { id: "all-notes-1s", title: "Every note under 1 s", text: "All twelve notes, sharps too" },
  { id: "streak-7", title: "7-day streak", text: "10 minutes a day for a week" },
  { id: "streak-30", title: "30-day streak", text: "10 minutes a day for a month" },
  { id: "hours-10", title: "10 hours", text: "Ten hours of practice in all" },
];

// Which milestones the history and settings meet right now (earned or not before). `records` should reach far
// back (the home reads 400 days) for the streak and hours.
export function metNow(records: readonly SessionRecord[], settings: PianoSettings, now: number): string[] {
  const songs = Object.values(settings.songs);
  const mastered = songs.filter((p) => p.mastered).length;
  const cut = now - SPEED_DAYS * 86_400_000;
  const keys = noteSpeed(statsFrom(records.filter((r) => r.startedAt >= cut), "notes")).keys;
  const fast = (names: readonly string[]) => names.every((n) => keys.find((k) => k.name === n)?.band === "fast");
  const run = streak(records, now);
  const ms = records.reduce((n, r) => n + r.durationMs, 0);
  const met: Record<string, boolean> = {
    "first-step": songs.some((p) => p.step >= 1 || p.mastered),
    "first-song": mastered >= 1,
    "five-songs": mastered >= 5,
    "naturals-1s": fast(NATURALS),
    "all-notes-1s": fast(keys.map((k) => k.name)),
    "streak-7": run >= 7,
    "streak-30": run >= 30,
    "hours-10": ms >= 10 * 3_600_000,
  };
  return MILESTONES.filter((m) => met[m.id]).map((m) => m.id);
}

// Milestones met now that the settings don't have yet (to save and announce).
export const newlyMet = (records: readonly SessionRecord[], settings: PianoSettings, now: number) => metNow(records, settings, now).filter((id) => !(id in (settings.milestones ?? {})));
