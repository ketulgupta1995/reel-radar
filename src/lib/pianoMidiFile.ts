// Standard MIDI File reader for Piano's song import (pure, no dependencies). The file is untrusted input:
// it is size-capped, every read is bounds-checked, every loop consumes at least one byte, and any problem
// is thrown as a MidiFileError with a code the import screen turns into a message.
//
// Handles formats 0 and 1 (format 2 is refused), variable-length quantities, running status, note on/off
// (a note-on with velocity 0 is an off), the first tempo (-> bpm), the first time signature (-> beatsPerBar) and
// track names. Sysex and every other meta event are skipped by their length. Channel 10 (drums) is dropped.
// Ticks become beats (quarter notes) through the header's ticks-per-quarter-note division; SMPTE division is refused.
// Starts and lengths are quantized to the nearest 1/4 beat (a sixteenth in 4/4; triplets and swing get rounded
// to it), and a note is at least 1/4 beat long. A note still sounding at the end of its track is closed there.
export type MidiErrorCode = "invalid" | "unsupported" | "too-big" | "empty";
export class MidiFileError extends Error {
  constructor(
    readonly code: MidiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MidiFileError";
  }
}

export const MAX_MIDI_BYTES = 256 * 1024;
export const MAX_NOTES = 5000;
export const MAX_TRACKS = 128;
export const QUANTUM = 0.25; // beats
export const MIN_SONG_BPM = 40;
export const MAX_SONG_BPM = 240;

export type ParsedNote = { start: number; dur: number; pitch: number; track: number; channel: number };
export type ParsedMidi = {
  title?: string;
  format: 0 | 1;
  bpm: number; // quarter notes a minute, clamped to 40-240
  beatsPerBar: number; // in quarter notes: 6/8 is 3
  notes: ParsedNote[]; // sorted by start then pitch; the first note starts within the first bar
};

const bad = (why: string) => new MidiFileError("invalid", `This isn't a readable MIDI file (${why}).`);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const quant = (beats: number) => Math.round(beats / QUANTUM) * QUANTUM;

function decodeName(bytes: Uint8Array): string {
  let text: string;
  try {
    text = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8").decode(bytes) : String.fromCharCode(...bytes);
  } catch {
    text = String.fromCharCode(...bytes);
  }
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f�]/g, "").trim().slice(0, 80);
}

type Track = { index: number; title?: string };

export function parseMidiFile(data: Uint8Array): ParsedMidi {
  if (data.length > MAX_MIDI_BYTES) throw new MidiFileError("too-big", `That file is too big (over ${MAX_MIDI_BYTES / 1024} KB). Pick a smaller MIDI file.`);
  if (data.length < 14) throw bad("too short");
  const u16 = (p: number) => (data[p] << 8) | data[p + 1];
  const u32 = (p: number) => data[p] * 0x1000000 + ((data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]);
  const tag = (p: number) => String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]);

  if (tag(0) !== "MThd") throw bad("no MIDI header");
  const headLen = u32(4);
  if (headLen < 6 || headLen > 1024 || 8 + headLen > data.length) throw bad("bad header");
  const format = u16(8);
  const division = u16(12);
  if (format === 2) throw new MidiFileError("unsupported", "This MIDI file is format 2 (several independent songs), which isn't supported.");
  if (format > 2) throw bad("unknown format");
  if (division & 0x8000) throw new MidiFileError("unsupported", "This MIDI file uses SMPTE time, which isn't supported.");
  if (division === 0) throw bad("zero time division");

  const rawNotes: ParsedNote[] = [];
  const names: string[] = [];
  let tempo: { tick: number; us: number } | undefined;
  let sig: { tick: number; beats: number } | undefined;
  let tracks = 0;
  let total = 0; // note-ons seen, to stop at MAX_NOTES

  let pos = 8 + headLen;
  while (pos < data.length) {
    if (pos + 8 > data.length) throw bad("cut off");
    const kind = tag(pos);
    const len = u32(pos + 4);
    const start = pos + 8;
    if (len > data.length - start) throw bad("cut off");
    pos = start + len;
    if (kind !== "MTrk") continue; // unknown chunks are skipped by length
    if (++tracks > MAX_TRACKS) throw new MidiFileError("too-big", "That MIDI file has too many tracks.");
    const track: Track = { index: tracks - 1 };
    readTrack(start, start + len, track);
    if (track.title && !names.length) names.push(track.title);
  }
  if (!tracks) throw bad("no tracks");
  if (!rawNotes.length) throw new MidiFileError("empty", "No notes found in that MIDI file.");

  function readTrack(from: number, end: number, track: Track) {
    let p = from;
    let tick = 0;
    let running = 0;
    const open = new Map<number, number[]>(); // channel*128+pitch -> start ticks of notes still sounding
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= end) throw bad("cut off");
        const b = data[p++];
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw bad("bad delta time");
    };
    const close = (key: number, at: number) => {
      const starts = open.get(key);
      const s = starts?.shift();
      if (s === undefined) return;
      rawNotes.push({ start: s / division, dur: (at - s) / division, pitch: key & 127, track: track.index, channel: key >> 7 });
    };
    while (p < end) {
      tick += vlq();
      if (p >= end) throw bad("cut off");
      let status = data[p];
      if (status & 0x80) {
        p++;
        if (status < 0xf0) running = status;
        else running = 0;
      } else {
        if (!running) throw bad("data without a status");
        status = running;
      }
      if (status === 0xff) {
        if (p >= end) throw bad("cut off");
        const type = data[p++];
        const n = vlq();
        if (n > end - p) throw bad("cut off");
        if (type === 0x2f) {
          break;
        } else if (type === 0x51 && n === 3) {
          const us = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
          if (us > 0 && (!tempo || tick < tempo.tick)) tempo = { tick, us };
        } else if (type === 0x58 && n >= 2) {
          const nn = data[p];
          const dd = data[p + 1];
          if (nn > 0 && dd <= 6 && (!sig || tick < sig.tick)) sig = { tick, beats: clamp(Math.round((nn * 4) / 2 ** dd), 1, 12) };
        } else if (type === 0x03 && !track.title) {
          track.title = decodeName(data.subarray(p, p + n));
        }
        p += n;
      } else if (status === 0xf0 || status === 0xf7) {
        const n = vlq();
        if (n > end - p) throw bad("cut off");
        p += n;
      } else if (status >= 0xf1) {
        throw bad("unexpected system message");
      } else {
        const need = (status >> 4) === 0xc || (status >> 4) === 0xd ? 1 : 2;
        if (p + need > end) throw bad("cut off");
        const d1 = data[p];
        const d2 = need === 2 ? data[p + 1] : 0;
        if ((d1 | d2) & 0x80) throw bad("bad data byte");
        p += need;
        const channel = status & 15;
        const type = status >> 4;
        if (channel === 9 || (type !== 8 && type !== 9)) continue; // drums, and everything but notes
        const key = channel * 128 + d1;
        if (type === 9 && d2 > 0) {
          if (++total > MAX_NOTES) throw new MidiFileError("too-big", `That song has more than ${MAX_NOTES} notes, which is too many to import.`);
          open.set(key, [...(open.get(key) ?? []), tick]);
        } else {
          close(key, tick);
        }
      }
    }
    for (const key of [...open.keys()]) while (open.get(key)?.length) close(key, tick); // still sounding at the end of the track
  }

  const bpm = tempo ? clamp(Math.round(60_000_000 / tempo.us), MIN_SONG_BPM, MAX_SONG_BPM) : 120;
  const beatsPerBar = sig?.beats ?? 4;

  // Quantize, drop exact repeats (same start and pitch: keep the longer), sort, and drop whole empty bars at the start.
  const best = new Map<string, ParsedNote>();
  for (const n of rawNotes) {
    const start = quant(n.start);
    const dur = Math.max(QUANTUM, quant(n.start + n.dur) - start);
    const k = `${start}:${n.pitch}`;
    const had = best.get(k);
    if (!had || dur > had.dur) best.set(k, { ...n, start, dur });
  }
  const notes = [...best.values()].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const shift = Math.floor(notes[0].start / beatsPerBar) * beatsPerBar;
  if (shift) for (const n of notes) n.start -= shift;
  return { title: names[0] || undefined, format: format as 0 | 1, bpm, beatsPerBar, notes };
}
