// Today's practice (pure): three steps chosen from the practice history, each with ordered alternates for Swap.
//   warm-up (2 min)   items missed or slow yesterday in the note or five-finger drill, else five-finger at the learner's level
//   weak spot (3 min) the drill with the worst error rate over the last 7 local days, limited to its weakest items
//   song (5 min)      the song in progress (most recently changed, not mastered) at its next hands-ladder step and ladder tempo,
//                     else the next easiest unmastered song. About once a week a mastered song comes back instead (review):
//                     when no mastered song was played in the last REVIEW_GAP_DAYS, the one unplayed longest (at least
//                     REVIEW_DAYS) is the song step at full tempo, and the song in progress becomes the first alternate
// Deterministic: no clock except `now`, no randomness. Days are local days, like pianoLog.
import type { SessionRecord, Stats } from "./pianoDrill";
import { statsFrom } from "./pianoDrill";
import type { PianoSettings } from "./pianoData";
import { dayKey } from "./pianoLog";
import { FINGER_DRILL } from "./pianoFingerDrill";
import { HANDS_LADDER, LAST_STEP, ladderTempo } from "./pianoSongLadder";
import type { SongMode } from "./pianoSongLadder";
import type { HandChoice, Song } from "./pianoSongs";
import { SONGS } from "./pianoSongLibrary";
import { RHYTHM_ID } from "./pianoRhythm";
import { EAR_ID } from "./pianoEarDrill";

export const WARMUP_MIN = 2;
export const WEAK_MIN = 3;
export const SONG_MIN = 5;
export const WEAK_DAYS = 7; // today and the 6 days before
export const MIN_WEAK_ATTEMPTS = 10; // a drill needs this many attempts in the window to be ranked by its error rate
export const MAX_ITEMS = 5; // items in a filter
export const REVIEW_DAYS = 10; // a mastered song is due for review when it hasn't been played for this long
export const REVIEW_GAP_DAYS = 7; // and no mastered song was played this recently (so reviews come about weekly)

export type DrillTarget = { kind: "drill"; drill: string; items?: string[]; minutes: number };
export type SongTarget = { kind: "song"; song: string; hands: HandChoice; mode: SongMode; tempo: number; minutes: number };
export type Target = DrillTarget | SongTarget;
export type StepId = "warmup" | "weak" | "song";
export type Step = { id: StepId; target: Target; label: string; why: string };
export type Plan = { steps: [Step, Step, Step]; alternates: [Step[], Step[], Step[]] };

const DRILL_TITLES: Record<string, string> = { notes: "Note drill", chords: "Chord drill", fingers: FINGER_DRILL.title, [RHYTHM_ID]: "Rhythm drill", [EAR_ID]: "Ear training" };
const NOUN: Record<string, string> = { notes: "notes", chords: "chords", fingers: "finger keys", [RHYTHM_ID]: "patterns", [EAR_ID]: "sounds" };
const WEAK_ORDER = ["notes", "chords", "fingers", RHYTHM_ID, EAR_ID]; // tie-break and the order of drills with no data
const OPT_IN = new Set([RHYTHM_ID, EAR_ID]); // offered without data only once they have been played

const itemScore = (s: Stats) => s.misses + 0.5 * s.slow; // a slow answer is half a miss (as pianoDrill)
const plural = (n: number, noun: string) => `${n} ${noun}`;

const startOfDay = (now: number, back: number) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
};
const inDay = (r: SessionRecord, key: string) => dayKey(new Date(r.startedAt)) === key;

// Up to MAX_ITEMS item ids, worst first (by score, then attempts, then id).
function worstItems(stats: Record<string, Stats>): string[] {
  return Object.entries(stats)
    .filter(([, s]) => s.attempts > 0 && itemScore(s) > 0)
    .sort(([ia, a], [ib, b]) => itemScore(b) / b.attempts - itemScore(a) / a.attempts || b.attempts - a.attempts || (ia < ib ? -1 : 1))
    .slice(0, MAX_ITEMS)
    .map(([id]) => id);
}

const drillStep = (id: StepId, drill: string, minutes: number, items: string[] | undefined, why: string, label?: string): Step => ({
  id,
  target: { kind: "drill", drill, ...(items ? { items } : {}), minutes },
  label: label ?? `${DRILL_TITLES[drill]}${items ? `: ${items.length} weakest` : ""}`,
  why,
});

const same = (a: Step, b: Step) => JSON.stringify(a.target) === JSON.stringify(b.target);
const dedupe = (steps: Step[]) => steps.reduce<Step[]>((out, s) => (out.some((o) => same(o, s)) ? out : [...out, s]), []);

function warmupCandidates(records: readonly SessionRecord[], settings: PianoSettings, now: number): Step[] {
  const yKey = dayKey(new Date(startOfDay(now, 1)));
  const yesterday = records.filter((r) => inDay(r, yKey));
  const flagged = ["notes", "fingers"]
    .map((drill) => {
      const stats = statsFrom(yesterday, drill);
      const items = worstItems(stats);
      const total = Object.values(stats).reduce((n, s) => n + itemScore(s), 0);
      const count = Object.values(stats).filter((s) => itemScore(s) > 0).length;
      return { drill, items, total, count };
    })
    .filter((f) => f.items.length)
    .sort((a, b) => b.total - a.total);
  const out = flagged.map((f) =>
    drillStep("warmup", f.drill, WARMUP_MIN, f.items, `Slow or missed ${plural(f.count, NOUN[f.drill])} yesterday`, `${DRILL_TITLES[f.drill]}: yesterday's ${NOUN[f.drill]}`),
  );
  const level = Math.max(1, Math.min(settings.unlocks.fingers ?? 1, FINGER_DRILL.groupNames.length));
  // At the first level the warm-up is the right-hand C position; later levels use the whole unlocked pool.
  const cItems = level <= 1 ? [1, 2, 3, 4, 5].map((f) => `RH-C-${f}`) : undefined;
  out.push(drillStep("warmup", "fingers", WARMUP_MIN, cItems, `Five-finger positions at your level (${level} of ${FINGER_DRILL.groupNames.length})`, cItems ? "Five-finger C" : "Five-finger positions"));
  out.push(drillStep("warmup", "notes", WARMUP_MIN, undefined, "Warm up on the notes you know", "Note drill"));
  return dedupe(out);
}

function weakCandidates(records: readonly SessionRecord[], now: number): Step[] {
  const from = startOfDay(now, WEAK_DAYS - 1);
  const week = records.filter((r) => r.startedAt >= from && r.startedAt <= now);
  const rows = WEAK_ORDER.map((drill, order) => {
    const stats = statsFrom(week, drill);
    const attempts = Object.values(stats).reduce((n, s) => n + s.attempts, 0);
    const score = Object.values(stats).reduce((n, s) => n + itemScore(s), 0);
    return { drill, order, attempts, rate: attempts ? score / attempts : 0, items: worstItems(stats) };
  });
  const ranked = rows.filter((r) => r.attempts >= MIN_WEAK_ATTEMPTS).sort((a, b) => b.rate - a.rate || a.order - b.order);
  const out = ranked.map((r) =>
    drillStep("weak", r.drill, WEAK_MIN, r.items.length ? r.items : undefined, `Error rate ${Math.round(r.rate * 100)}% over the last ${WEAK_DAYS} days`),
  );
  // Drills without enough data come after, in a fixed order; rhythm and ear training only when they have been played.
  const rest = rows.filter((r) => r.attempts < MIN_WEAK_ATTEMPTS && (!OPT_IN.has(r.drill) || r.attempts > 0));
  out.push(...rest.map((r) => drillStep("weak", r.drill, WEAK_MIN, undefined, r.attempts ? "Not enough rounds yet to rank" : "No practice yet this week")));
  return dedupe(out);
}

function songStep(song: Song, step: number, tempo: number, why: string): Step {
  const l = HANDS_LADDER[Math.min(Math.max(step, 0), LAST_STEP)];
  return { id: "song", target: { kind: "song", song: song.id, hands: l.hands, mode: l.mode, tempo, minutes: SONG_MIN }, label: `${song.title}: ${l.label}`, why };
}

// When each song was last played: its latest "songs" record (records only reach PLAN_DAYS back), else when its
// progress last changed.
function lastPlayedAt(records: readonly SessionRecord[], settings: PianoSettings, id: string): number {
  let at = settings.songs?.[id]?.at ?? 0;
  for (const r of records) if (r.kind === "drill" && r.drill === "songs" && id in r.items) at = Math.max(at, r.startedAt);
  return at;
}

// The mastered song to review today, or null (see the header).
function reviewSong(records: readonly SessionRecord[], settings: PianoSettings, now: number): { song: Song; days: number } | null {
  const mastered = SONGS.filter((s) => settings.songs?.[s.id]?.mastered).map((song) => ({ song, at: lastPlayedAt(records, settings, song.id) }));
  if (!mastered.length || mastered.some((m) => now - m.at < REVIEW_GAP_DAYS * DAY)) return null;
  const due = mastered.filter((m) => now - m.at >= REVIEW_DAYS * DAY).sort((a, b) => a.at - b.at)[0];
  return due ? { song: due.song, days: Math.floor((now - due.at) / DAY) } : null;
}
const DAY = 86_400_000;

function songCandidates(records: readonly SessionRecord[], settings: PianoSettings, now: number): Step[] {
  const prog = (s: Song) => settings.songs?.[s.id];
  const index = new Map(SONGS.map((s, i) => [s.id, i]));
  const live = SONGS.filter((s) => prog(s) && !prog(s)!.mastered).sort((a, b) => prog(b)!.at - prog(a)!.at || index.get(a.id)! - index.get(b.id)!);
  const fresh = SONGS.filter((s) => !prog(s));
  const done = SONGS.filter((s) => prog(s)?.mastered);
  const review = reviewSong(records, settings, now);
  const out = [
    ...live.map((s) => songStep(s, prog(s)!.step, ladderTempo(s, prog(s)), "The song you are learning, next step")),
    ...fresh.map((s) => songStep(s, 0, ladderTempo(s), live.length ? "A new song" : "The easiest song you have not mastered")),
    ...done.filter((s) => s !== review?.song).map((s) => songStep(s, LAST_STEP, s.bpm, "Mastered: play it again at full tempo")),
  ];
  if (!review) return out;
  const r = songStep(review.song, LAST_STEP, review.song.bpm, `Mastered, not played for ${review.days} days: keep it fresh`);
  return [{ ...r, label: `Review: ${review.song.title}` }, ...out];
}

export function plan(records: readonly SessionRecord[], settings: PianoSettings, now: number): Plan {
  const split = (c: Step[]): [Step, Step[]] => [c[0], c.slice(1)];
  const [k, ka] = split(weakCandidates(records, now));
  // The warm-up is not the weak spot again (yesterday's misses are often the week's too, e.g. when yesterday was the
  // only practice): it takes the first candidate that differs from the weak spot; the others stay alternates, in order.
  const work = (st: Step) => JSON.stringify({ ...st.target, minutes: 0 });
  const wc = warmupCandidates(records, settings, now);
  const wi = Math.max(0, wc.findIndex((c) => work(c) !== work(k)));
  const [w, wa]: [Step, Step[]] = [wc[wi], wc.filter((_, i) => i !== wi)];
  const [s, sa] = split(songCandidates(records, settings, now));
  return { steps: [w, k, s], alternates: [wa, ka, sa] };
}

export const canSwap = (p: Plan, i: 0 | 1 | 2) => p.alternates[i].length > 0;

// Replaces step i with its next alternate (the replaced step is dropped). With no alternate left the plan is returned unchanged.
export function swap(p: Plan, i: 0 | 1 | 2): Plan {
  if (!canSwap(p, i)) return p;
  const steps = [...p.steps] as Plan["steps"];
  const alternates = [...p.alternates] as Plan["alternates"];
  steps[i] = alternates[i][0];
  alternates[i] = alternates[i].slice(1);
  return { steps, alternates };
}
