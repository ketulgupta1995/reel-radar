// Bar loops (pure, plus a small per-device store): practise a few bars of a song over and over, with a tempo
// ladder of their own. Bars are counted the way pianoSongPlay.barOf counts them (bar 1 starts on beat 0, so a
// pickup bar is bar 1), which is what "You rush in bar 6" refers to.
//
// A loop never moves the song's own ladders (pianoSongLadder): its runs are saved as practice, and its tempo is kept
// per device in localStorage `reel-radar-piano-loops` {[songId:from-to]: {tempo, speed}} (not synced; it is a
// scratch setting for this week's hard bars).
import { GOOD_ON_TIME, TEMPO_STEP, startTempo } from "./pianoSongLadder";
import { Song, songBeats, sortNotes } from "./pianoSongs";

export type BarRange = { from: number; to: number }; // 1-based, inclusive
export type LoopLadder = { tempo: number; speed: number }; // play-along BPM; wait-mode speed in % (25-100)

export const LOOP_START_SPEED = 50;
export const SPEED_STEP = 10;
export const MIN_SPEED = 25;
const KEY = "reel-radar-piano-loops";

export const barCount = (song: Pick<Song, "notes" | "beatsPerBar">) => Math.max(1, Math.ceil(songBeats(song) / song.beatsPerBar));

// A range clamped to the song's bars, `from` <= `to`.
export function clampRange(song: Pick<Song, "notes" | "beatsPerBar">, r: BarRange): BarRange {
  const n = barCount(song);
  const from = Math.min(n, Math.max(1, Math.round(r.from)));
  const to = Math.min(n, Math.max(from, Math.round(r.to)));
  return { from, to };
}

// The song cut to bars `from`..`to`: notes that start inside, moved to start at beat 0, cut off at the range's end.
// The id stays the song's (a loop run is practice on that song); chord marks are cut the same way.
export function sliceSong(song: Song, range: BarRange): Song {
  const { from, to } = clampRange(song, range);
  const a = (from - 1) * song.beatsPerBar;
  const b = to * song.beatsPerBar;
  const notes = sortNotes(song.notes.filter((n) => n.start >= a && n.start < b).map((n) => ({ ...n, start: n.start - a, dur: Math.min(n.dur, b - n.start) })));
  const chords = song.chords?.filter((c) => c.start < b && c.start + c.dur > a).map((c) => ({ ...c, start: Math.max(0, c.start - a), dur: Math.min(c.start + c.dur, b) - Math.max(c.start, a) }));
  return { ...song, notes, ...(chords ? { chords } : {}) };
}

export const rangeText = (r: BarRange) => (r.from === r.to ? `bar ${r.from}` : `bars ${r.from}–${r.to}`);
export const loopKey = (songId: string, r: BarRange) => `${songId}:${r.from}-${r.to}`;
export const startLadder = (song: Pick<Song, "bpm">): LoopLadder => ({ tempo: startTempo(song.bpm), speed: LOOP_START_SPEED });

// After a play-along run of the loop: +5 BPM at >= 90% on time, capped at the song's tempo.
export const loopAfterPlay = (song: Pick<Song, "bpm">, l: LoopLadder, onTime: number): LoopLadder =>
  onTime >= GOOD_ON_TIME ? { ...l, tempo: Math.min(song.bpm, l.tempo + TEMPO_STEP) } : l;
// After a finished wait run of the loop: +10% speed when it had no wrong keys, up to 100%.
export const loopAfterWait = (l: LoopLadder, misses: number): LoopLadder => (misses === 0 ? { ...l, speed: Math.min(100, l.speed + SPEED_STEP) } : l);

type Store = Record<string, LoopLadder>;
function readStore(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// The saved ladder of a loop, or the start (60% tempo, 50% speed). Bad values fall back to the start.
export function loadLoop(song: Pick<Song, "id" | "bpm">, r: BarRange): LoopLadder {
  const s = readStore()[loopKey(song.id, r)];
  const start = startLadder(song);
  if (!s || typeof s !== "object") return start;
  const tempo = Number.isFinite(s.tempo) ? Math.min(song.bpm, Math.max(1, s.tempo)) : start.tempo;
  const speed = Number.isFinite(s.speed) ? Math.min(100, Math.max(MIN_SPEED, s.speed)) : start.speed;
  return { tempo, speed };
}

export function saveLoop(songId: string, r: BarRange, l: LoopLadder) {
  try {
    const s = readStore();
    s[loopKey(songId, r)] = l;
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked: the ladder just isn't remembered
  }
}
