// Turns a parsed MIDI file into a Song for Piano (pure): picks each note's hand, suggests fingering, and
// packs the song into the small doc that is stored and synced (`piano-song-<id>`).
//
// Hands: when exactly two tracks carry notes, the one with the higher average pitch is the right hand; when
// one track carries notes on exactly two channels, the same rule applies to the channels. Anything else
// (a single part, or three or more) is split at a pitch: notes at or above the split are the right hand
// (default 60, middle C; the import screen lets the player move it and shows the counts).
import { suggestFingering } from "./pianoFingering";
import { MAX_NOTES, MAX_SONG_BPM, MIN_SONG_BPM, ParsedMidi } from "./pianoMidiFile";
import { Hand, Song, SongNote, sortNotes } from "./pianoSongs";

export const DEFAULT_SPLIT = 60;
export const MAX_SONG_DOC_BYTES = 200 * 1024;
export const MAX_TITLE = 80;
export const SONG_ID = /^[0-9a-f]{12}$/;
export const MAX_SONG_BEATS = 20_000;

export type HandPlan = { by: "tracks" | "channels" | "split"; hands: Hand[] }; // hands[i] is the hand of parsed.notes[i]

export function planHands(parsed: ParsedMidi, split = DEFAULT_SPLIT): HandPlan {
  const groupBy = (key: (n: ParsedMidi["notes"][number]) => number) => {
    const groups = new Map<number, number[]>();
    parsed.notes.forEach((n, i) => groups.set(key(n), [...(groups.get(key(n)) ?? []), i]));
    return groups;
  };
  const byTrack = groupBy((n) => n.track);
  const byChannel = byTrack.size === 1 ? groupBy((n) => n.channel) : undefined;
  const groups = byTrack.size === 2 ? byTrack : byChannel?.size === 2 ? byChannel : undefined;
  if (groups) {
    const avg = (ids: number[]) => ids.reduce((a, i) => a + parsed.notes[i].pitch, 0) / ids.length;
    const [a, b] = [...groups.values()];
    const right = avg(b) > avg(a) ? b : a;
    const hands = parsed.notes.map((_, i): Hand => (right.includes(i) ? "R" : "L"));
    return { by: byTrack.size === 2 ? "tracks" : "channels", hands };
  }
  return { by: "split", hands: parsed.notes.map((n): Hand => (n.pitch >= split ? "R" : "L")) };
}

export const handCounts = (hands: Hand[]) => ({ R: hands.filter((h) => h === "R").length, L: hands.filter((h) => h === "L").length });

// Bars the song covers (a partial last bar counts).
export const barsOf = (notes: readonly { start: number; dur: number }[], beatsPerBar: number) =>
  Math.max(1, Math.ceil(notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0) / beatsPerBar - 1e-9));

export function buildImportedSong(parsed: ParsedMidi, plan: HandPlan, id: string, title: string): Song {
  const notes: SongNote[] = [];
  for (const hand of ["R", "L"] as Hand[]) {
    const mine = parsed.notes.filter((_, i) => plan.hands[i] === hand);
    const fingers = suggestFingering(mine, hand);
    mine.forEach((n, i) => notes.push({ start: n.start, dur: n.dur, pitch: n.pitch, hand, finger: fingers[i], suggested: true }));
  }
  return { id, title: cleanTitle(title) || "Imported song", bpm: parsed.bpm, beatsPerBar: parsed.beatsPerBar, level: 0, imported: true, notes: sortNotes(notes) };
}

// eslint-disable-next-line no-control-regex
export const cleanTitle = (t: unknown) => (typeof t === "string" ? t.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, MAX_TITLE) : "");

// ---- the stored doc: notes as [start, dur, pitch, hand (1 = right), finger] rows, about 20 bytes a note ----
export type SongDoc = {
  v: 1;
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  split?: number; // the split point used, when the hands came from it
  notes: [number, number, number, 0 | 1, number][];
  removed?: undefined;
};
export type TombstoneDoc = { removed: true };

export function encodeSong(song: Song, split?: number): SongDoc {
  return {
    v: 1,
    id: song.id,
    title: song.title,
    bpm: song.bpm,
    beatsPerBar: song.beatsPerBar,
    ...(split === undefined ? {} : { split }),
    notes: song.notes.map((n) => [n.start, n.dur, n.pitch, n.hand === "R" ? 1 : 0, n.finger]),
  };
}

const num = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

// Reads a stored or synced doc back into a Song, or undefined when it isn't a valid one (it came over the
// network, so nothing is trusted). Every note is marked suggested.
export function decodeSong(doc: unknown, id: string): Song | undefined {
  const d = doc as Partial<SongDoc> | null;
  if (!d || typeof d !== "object" || d.v !== 1 || d.id !== id || !SONG_ID.test(id)) return undefined;
  const title = cleanTitle(d.title);
  if (!title || !num(d.bpm, MIN_SONG_BPM, MAX_SONG_BPM) || !num(d.beatsPerBar, 1, 12)) return undefined;
  if (!Array.isArray(d.notes) || !d.notes.length || d.notes.length > MAX_NOTES) return undefined;
  const notes: SongNote[] = [];
  for (const r of d.notes) {
    if (!Array.isArray(r) || r.length !== 5) return undefined;
    const [start, dur, pitch, hand, finger] = r;
    if (!num(start, 0, MAX_SONG_BEATS) || !num(dur, 0.01, MAX_SONG_BEATS) || !num(pitch, 0, 127) || !Number.isInteger(pitch) || (hand !== 0 && hand !== 1) || !num(finger, 1, 5) || !Number.isInteger(finger)) return undefined;
    notes.push({ start, dur, pitch, hand: hand ? "R" : "L", finger, suggested: true });
  }
  return { id, title, bpm: d.bpm, beatsPerBar: d.beatsPerBar, level: 0, imported: true, notes: sortNotes(notes) };
}
