// Play-along (pure): where each note falls in time, scoring a run against the notes of the chosen hand(s),
// and the summary (on-time %, early/late counts, average offset, the bars where you rush or drag).
// All times are ms on the performance.now() clock, like pianoTiming.
import { Grade, Score, beatInterval, scoreRun, DEFAULT_WINDOW_MS } from "./pianoTiming";
import { HandChoice, Song, SongNote, handOf, songBeats } from "./pianoSongs";

export const COUNT_IN_BARS = 1;
export const RUSH_DRAG_MS = 15; // a bar's mean offset must reach this to be called rushing or dragging

// Time of song beat `beat` in a run whose count-in starts at `startMs`.
export const beatTime = (startMs: number, bpm: number, beatsPerBar: number, beat: number) => startMs + (COUNT_IN_BARS * beatsPerBar + beat) * beatInterval(bpm);
export const runEndMs = (song: Song, startMs: number, bpm: number) => beatTime(startMs, bpm, song.beatsPerBar, songBeats(song));
export const barOf = (song: Pick<Song, "beatsPerBar">, n: SongNote) => Math.floor(n.start / song.beatsPerBar) + 1;

export type Onset = { note: SongNote; time: number };
export const onsetsFor = (song: Song, hands: HandChoice, startMs: number, bpm: number): Onset[] =>
  handOf(song.notes, hands).map((note) => ({ note, time: beatTime(startMs, bpm, song.beatsPerBar, note.start) }));

export type Hit = { note: number; time: number };
export type PlayOpts = { windowMs?: number; latencyMs?: number };
export type NoteScore = Score & { note: SongNote };

// Each expected note is scored on its own: it takes the nearest unused hit of its own key. Keys that
// answer no note (wrong keys, repeats) are `extra`.
export function scorePlayAlong(onsets: readonly Onset[], hits: readonly Hit[], o: PlayOpts = {}): { scores: NoteScore[]; extra: number } {
  const scores: NoteScore[] = new Array(onsets.length);
  let extra = 0;
  const pitches = new Set([...onsets.map((x) => x.note.pitch), ...hits.map((h) => h.note)]);
  for (const pitch of pitches) {
    const idx = onsets.flatMap((x, i) => (x.note.pitch === pitch ? [i] : []));
    const r = scoreRun(
      idx.map((i) => onsets[i].time),
      hits.filter((h) => h.note === pitch).map((h) => h.time),
      { windowMs: DEFAULT_WINDOW_MS, ...o },
    );
    idx.forEach((i, k) => (scores[i] = { ...r.scores[k], note: onsets[i].note }));
    extra += r.extra.length;
  }
  return { scores, extra };
}

export type BarStat = { bar: number; mean: number; n: number };
export type PlaySummary = {
  total: number;
  onTime: number;
  early: number;
  late: number;
  missed: number;
  extra: number;
  onTimePct: number; // 0-1
  meanOffsetMs: number; // signed: negative = early
  meanAbsMs: number;
  rush: BarStat | null; // the bar with the most negative mean offset (at least RUSH_DRAG_MS early)
  drag: BarStat | null;
};

export function summarize(song: Pick<Song, "beatsPerBar">, scores: readonly NoteScore[], extra: number): PlaySummary {
  const count = (g: Grade) => scores.filter((s) => s.grade === g).length;
  const hit = scores.filter((s) => s.offsetMs !== null);
  const offs = hit.map((s) => s.offsetMs as number);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const byBar = new Map<number, number[]>();
  for (const s of hit) {
    const b = barOf(song, s.note);
    byBar.set(b, [...(byBar.get(b) ?? []), s.offsetMs as number]);
  }
  const bars: BarStat[] = [...byBar].map(([bar, xs]) => ({ bar, mean: mean(xs), n: xs.length })).sort((a, b) => a.bar - b.bar);
  const worst = (sign: 1 | -1) => bars.filter((b) => b.mean * sign >= RUSH_DRAG_MS).sort((a, b) => b.mean * sign - a.mean * sign || a.bar - b.bar)[0] ?? null;
  return {
    total: scores.length,
    onTime: count("on"),
    early: count("early"),
    late: count("late"),
    missed: count("missed"),
    extra,
    onTimePct: scores.length ? count("on") / scores.length : 0,
    meanOffsetMs: mean(offs),
    meanAbsMs: mean(offs.map(Math.abs)),
    rush: worst(-1),
    drag: worst(1),
  };
}
