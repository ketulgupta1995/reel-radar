// The Library on the Piano home (pure, no browser APIs): one row per practice area with its level and a one-line weak
// spot from the last 7 days, built from the drills' own stats (statsFrom), the saved settings and song progress.
import type { PianoSettings } from "./pianoData";
import { CHORD_DRILL } from "./pianoChordDrill";
import { SessionRecord, Stats, statsFrom } from "./pianoDrill";
import { EXERCISES } from "./pianoExercises";
import { FINGER_DRILL } from "./pianoFingerDrill";
import { dayKey } from "./pianoLog";
import { NOTE_DRILL } from "./pianoNoteDrill";
import { GROUP_NAMES as RHYTHM_GROUPS, PATTERNS, RHYTHM_ID } from "./pianoRhythm";
import { SCALES, scaleUnlocked } from "./pianoScales";
import { progressLine } from "./pianoSongLadder";
import { SONGS } from "./pianoSongLibrary";

export const WEAK_WINDOW_DAYS = 7; // today and the 6 days before (as the planner)
export type LibraryRow = {
  key: string;
  title: string;
  href: string;
  level: string; // "L3", "3/12", "new"
  levelHint?: string; // "Level 3 of 4"
  note: string;
  weak: boolean; // the note names slow or missed items
};

const day = 86_400_000;
const startOfWindow = (now: number) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (WEAK_WINDOW_DAYS - 1)).getTime();
};
const score = (s: Stats) => s.misses + 0.5 * s.slow;

const flat = (id: string) => id.replace(/b/g, "♭");
const fingerLabel = (id: string) => {
  const m = /^(RH|LH)-([A-G]b?)-(\d)$/.exec(id);
  return m ? `${m[1]} finger ${m[3]} in ${flat(m[2])}` : id;
};
const rhythmLabel = (id: string) => PATTERNS.find((p) => p.id === id)?.name ?? id;

type Spec = { key: string; title: string; href: string; drill: string; groups: number; label: (id: string) => string; max: number };
const SPECS: Spec[] = [
  { key: "notes", title: "Notes", href: "/piano/notes", drill: NOTE_DRILL.id, groups: NOTE_DRILL.groupNames.length, label: (id) => id, max: 3 },
  { key: "chords", title: "Chords", href: "/piano/chords", drill: CHORD_DRILL.id, groups: CHORD_DRILL.groupNames.length, label: flat, max: 3 },
  { key: "fingers", title: "Five fingers", href: "/piano/fingers", drill: FINGER_DRILL.id, groups: FINGER_DRILL.groupNames.length, label: fingerLabel, max: 2 },
  { key: "rhythm", title: "Rhythm", href: "/piano/rhythm", drill: RHYTHM_ID, groups: RHYTHM_GROUPS.length, label: rhythmLabel, max: 2 },
];

// The worst items of a drill over the last 7 days, worst first (up to `max`): "Slow: F#, B♭" when slow answers
// dominate them, "Missed: G7, F" otherwise. Null when nothing was missed or slow.
export function weakSpot(records: readonly SessionRecord[], drill: string, now: number, label: (id: string) => string, max = 3): string | null {
  const from = startOfWindow(now);
  const stats = statsFrom(records.filter((r) => r.startedAt >= from && r.startedAt <= now), drill);
  const worst = Object.entries(stats)
    .filter(([, s]) => s.attempts > 0 && score(s) > 0)
    .sort(([ia, a], [ib, b]) => score(b) / b.attempts - score(a) / a.attempts || b.attempts - a.attempts || (ia < ib ? -1 : 1))
    .slice(0, max);
  if (!worst.length) return null;
  const misses = worst.reduce((n, [, s]) => n + s.misses, 0);
  const slow = worst.reduce((n, [, s]) => n + s.slow, 0);
  return `${misses >= slow ? "Missed" : "Slow"}: ${worst.map(([id]) => label(id)).join(", ")}`;
}

// "Not started", "today", "yesterday" or "N days ago" from the latest round of the drill in `records`.
export function lastPlayed(records: readonly SessionRecord[], drill: string, now: number): string {
  const times = records.flatMap((r) => (r.kind === "drill" && r.drill === drill ? [r.startedAt] : []));
  if (!times.length) return "Not started";
  const ago = Math.round((new Date(dayKey(new Date(now))).getTime() - new Date(dayKey(new Date(Math.max(...times)))).getTime()) / day);
  return ago <= 0 ? "Practised today" : ago === 1 ? "Practised yesterday" : `${ago} days ago`;
}

function songsRow(settings: PianoSettings): LibraryRow {
  const prog = (id: string) => settings.songs[id];
  const mastered = SONGS.filter((s) => prog(s.id)?.mastered).length;
  const live = SONGS.filter((s) => prog(s.id) && !prog(s.id)!.mastered).sort((a, b) => prog(b.id)!.at - prog(a.id)!.at)[0];
  const note = live ? `${live.title} · ${progressLine(prog(live.id))}` : mastered ? "Pick the next song" : "Not started";
  return { key: "songs", title: "Songs", href: "/piano/songs", level: `${mastered}/${SONGS.length}`, levelHint: `${mastered} of ${SONGS.length} mastered`, note, weak: false };
}

function scalesRow(settings: PianoSettings): LibraryRow {
  const open = SCALES.filter((_, i) => scaleUnlocked(i, (id) => settings.songs[id])).length;
  const started = SCALES.filter((s) => settings.songs[s.id]).length;
  const exercises = EXERCISES.filter((e) => settings.songs[e.id]).length;
  const note = started || exercises ? `${started} scales played · coordination ${exercises}/${EXERCISES.length}` : "Not started";
  return { key: "scales", title: "Scales & hands", href: "/piano/scales", level: started || exercises ? `${open}/${SCALES.length}` : "new", levelHint: `${open} of ${SCALES.length} scales open`, note, weak: false };
}

// Every area of the Library in display order (the tools are fixed links the page adds).
export function libraryRows(records: readonly SessionRecord[], settings: PianoSettings, now: number): LibraryRow[] {
  const drills = SPECS.map((sp): LibraryRow => {
    const level = Math.min(sp.groups, Math.max(1, settings.unlocks[sp.drill] ?? 1));
    const weak = weakSpot(records, sp.drill, now, sp.label, sp.max);
    return { key: sp.key, title: sp.title, href: sp.href, level: `L${level}`, levelHint: `Level ${level} of ${sp.groups}`, note: weak ?? lastPlayed(records, sp.drill, now), weak: weak !== null };
  });
  return [...drills, songsRow(settings), scalesRow(settings)];
}
