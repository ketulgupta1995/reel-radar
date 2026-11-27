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
};

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

export type SongDef = { id: string; title: string; level: number; bpm: number; beatsPerBar: number; key: string; rh: string; lh: string };

export function buildSong(def: SongDef): Song {
  const r = parseHand(def.rh, "R");
  const l = parseHand(def.lh, "L");
  return { id: def.id, title: def.title, bpm: def.bpm, beatsPerBar: def.beatsPerBar, level: def.level, key: def.key, notes: sortNotes([...r.notes, ...l.notes]) };
}
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
