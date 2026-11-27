// Piano's song model (pure): notes with a start and length in beats, a MIDI pitch, a hand and a finger.
// Built-in songs are written in a compact notation (see parseHand) and parsed once. Later tickets
// (play-along, hands ladder, MIDI import, coordination exercises) build on this shape.
export type Hand = "R" | "L";
export type HandChoice = Hand | "both";
export type SongNote = {
  start: number; // beats from the first beat of the song (a pickup bar starts at 0)
  dur: number; // beats
  pitch: number; // MIDI, 60 = middle C
  hand: Hand;
  finger: number; // 1 (thumb) to 5
  suggested?: boolean; // fingering guessed by the app (imported songs), not hand-written
  cross?: "under" | "over"; // scales: the thumb passes under / a finger crosses over to reach this note
};
export type Song = {
  id: string;
  title: string;
  bpm: number; // quarter-note beats per minute at 100% speed
  beatsPerBar: number;
  level: number; // 1 = easiest
  key?: string; // display only: "C", "A minor"
  imported?: boolean; // from a MIDI file (level 0): its fingering is suggested, not hand-written
  notes: SongNote[]; // sorted by start, then pitch
  chords?: ChordMark[]; // melody + chords songs: the chord names over the melody (the left hand holds each one)
};
// A chord name over the melody: from `start` for `dur` beats (until the next change).
export type ChordMark = { start: number; dur: number; name: string };

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// "C4" = 60, "F#4", "Bb3".
export function parsePitch(s: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error(`Bad pitch "${s}"`);
  return (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

// One hand's part. Bars are separated by "|"; a bar's tokens by spaces.
//   token  = pitches [":" beats] ["/" fingers]
//   pitches = "E4" or a chord "C3+E3+G3"; fingers = "3" or "5+3+1" (one per pitch); beats default 1, "R" is a rest.
//   "E4:.5/3" an eighth on E with finger 3; "R:2" a two-beat rest.
// Returns the notes and each bar's length in beats (the first bar may be a pickup).
export function parseHand(text: string, hand: Hand): { notes: SongNote[]; bars: number[] } {
  const notes: SongNote[] = [];
  const bars: number[] = [];
  let at = 0;
  for (const bar of text.split("|")) {
    const start = at;
    for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
      const m = /^([^:/]+)(?::([\d.]+))?(?:\/([\d+]+))?$/.exec(tok);
      if (!m) throw new Error(`Bad token "${tok}"`);
      const dur = m[2] === undefined ? 1 : Number(m[2]);
      if (!(dur > 0)) throw new Error(`Bad length in "${tok}"`);
      if (m[1] !== "R") {
        const pitches = m[1].split("+").map(parsePitch);
        const fingers = (m[3] ?? "").split("+").filter(Boolean).map(Number);
        if (fingers.length !== pitches.length || fingers.some((f) => !(f >= 1 && f <= 5))) throw new Error(`Need a finger 1-5 per note in "${tok}"`);
        pitches.forEach((pitch, i) => notes.push({ start: at, dur, pitch, hand, finger: fingers[i] }));
      }
      at += dur;
    }
    bars.push(at - start);
  }
  return { notes, bars };
}

// A song is written either with a left-hand part (`lh`) or as a melody with chord names (`chords`, a lead sheet):
// the left hand then holds each chord (a close triad near C3, see chordVoicing) until the next change.
export type SongDef = { id: string; title: string; level: number; bpm: number; beatsPerBar: number; key: string; rh: string } & ({ lh: string; chords?: never } | { chords: string; lh?: never });

export function buildSong(def: SongDef): Song {
  const r = parseHand(def.rh, "R");
  const base = { id: def.id, title: def.title, bpm: def.bpm, beatsPerBar: def.beatsPerBar, level: def.level, key: def.key };
  if (def.chords !== undefined) {
    const chords = parseChords(def.chords, r.bars);
    return { ...base, notes: sortNotes([...r.notes, ...chordNotes(chords)]), chords };
  }
  const l = parseHand(def.lh, "L");
  return { ...base, notes: sortNotes([...r.notes, ...l.notes]) };
}

// ---------------- Chord charts ----------------

const QUALITY: Record<string, number[]> = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] };
// "C", "F#m", "Bb7", "Am7", "Fmaj7" -> pitch classes, root first. Throws on anything else.
export function chordPitchClasses(name: string): number[] {
  const m = /^([A-G])([#b]?)(m7|maj7|m|7)?$/.exec(name);
  if (!m) throw new Error(`Bad chord "${name}"`);
  const root = (SEMITONE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? 11 : 0)) % 12;
  return QUALITY[m[3] ?? ""].map((i) => (root + i) % 12);
}

export const VOICING_LOW = 47; // B2: every chord tone goes to its lowest pitch at or above this, so changes barely move
// The left hand's chord: each tone at its lowest pitch from B2 up, so C = C3 E3 G3, F = C3 F3 A3, G = B2 D3 G3,
// Am = C3 E3 A3 (the common beginner voicings). Fingers from the bottom: 5 3 1, or 5 3 2 1 for four notes.
export function chordVoicing(name: string): { pitches: number[]; fingers: number[] } {
  const pitches = chordPitchClasses(name)
    .map((pc) => VOICING_LOW + ((pc - VOICING_LOW) % 12 + 12) % 12)
    .sort((a, b) => a - b);
  return { pitches, fingers: pitches.length === 4 ? [5, 3, 2, 1] : [5, 3, 1] };
}

// A chord line: one group per bar, separated by "|" like the melody, and the same number of bars. A bar's tokens are
// chord names with an optional length, "F:2"; tokens without one share what is left of the bar evenly. "-" (or "N.C.")
// is no chord: the left hand rests. Returns the chord marks (no-chord gaps left out).
export function parseChords(text: string, bars: readonly number[]): ChordMark[] {
  const groups = text.split("|");
  if (groups.length !== bars.length) throw new Error(`Chords have ${groups.length} bars, the melody ${bars.length}`);
  const out: ChordMark[] = [];
  let at = 0;
  groups.forEach((g, i) => {
    const toks = g.trim().split(/\s+/).filter(Boolean).map((t) => {
      const m = /^([^:]+)(?::([\d.]+))?$/.exec(t)!;
      return { name: m[1], beats: m[2] === undefined ? null : Number(m[2]) };
    });
    if (!toks.length) throw new Error(`Bar ${i + 1} has no chord (use "-" for none)`);
    const fixed = toks.reduce((n, t) => n + (t.beats ?? 0), 0);
    const free = toks.filter((t) => t.beats === null).length;
    const each = free ? (bars[i] - fixed) / free : 0;
    if (each < 0 || (!free && Math.abs(fixed - bars[i]) > 1e-9) || (free && !(each > 0))) throw new Error(`Bar ${i + 1}: chord lengths don't fill ${bars[i]} beats`);
    for (const t of toks) {
      const dur = t.beats ?? each;
      if (t.name !== "-" && t.name !== "N.C.") {
        chordPitchClasses(t.name); // validates
        const last = out[out.length - 1];
        // the same chord over a bar line is held, not struck again
        if (last && last.name === t.name && Math.abs(last.start + last.dur - at) < 1e-9) last.dur += dur;
        else out.push({ start: at, dur, name: t.name });
      }
      at += dur;
    }
  });
  return out;
}

// The left hand's notes for a chord line: each chord held for its length.
export function chordNotes(chords: readonly ChordMark[]): SongNote[] {
  return chords.flatMap((c) => {
    const v = chordVoicing(c.name);
    return v.pitches.map((pitch, i) => ({ start: c.start, dur: c.dur, pitch, hand: "L" as const, finger: v.fingers[i] }));
  });
}

// The chord sounding at beat `at` and the next change after it (for the player's "C → F" line).
export function chordAt(chords: readonly ChordMark[] | undefined, at: number): { now: ChordMark | null; next: ChordMark | null } {
  if (!chords?.length) return { now: null, next: null };
  const now = chords.find((c) => c.start <= at + 1e-9 && at < c.start + c.dur - 1e-9) ?? null;
  const next = chords.find((c) => c.start > at + 1e-9) ?? null;
  return { now, next };
}
// Display: "Bb7" -> "B♭7".
export const chordLabel = (name: string) => name.replace(/^([A-G])b/, "$1♭");
export const sortNotes = (ns: SongNote[]) => [...ns].sort((a, b) => a.start - b.start || a.pitch - b.pitch);

// A step: the notes (of both hands) that start on the same beat. A chord is one step.
export type Step = { index: number; start: number; notes: SongNote[] };
export function stepsOf(song: Pick<Song, "notes">): Step[] {
  const out: Step[] = [];
  for (const n of sortNotes(song.notes)) {
    const last = out[out.length - 1];
    if (last && last.start === n.start) last.notes.push(n);
    else out.push({ index: out.length, start: n.start, notes: [n] });
  }
  return out;
}

export const handOf = (notes: readonly SongNote[], choice: HandChoice) => (choice === "both" ? [...notes] : notes.filter((n) => n.hand === choice));

// The keys to draw: the song's lowest and highest note, two semitones of padding, widened to white keys.
export function songRange(song: Pick<Song, "notes">): { low: number; high: number } {
  if (!song.notes.length) return { low: 48, high: 72 };
  const pitches = song.notes.map((n) => n.pitch);
  const black = (n: number) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);
  let low = Math.min(...pitches) - 2;
  let high = Math.max(...pitches) + 2;
  if (black(low)) low -= 1;
  if (black(high)) high += 1;
  return { low, high };
}

export const songBeats = (song: Pick<Song, "notes">) => song.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
export const beatMs = (bpm: number, speed: number) => 60000 / (bpm * speed);
