// Builds fake Standard MIDI Files for tests: events as byte arrays (delta time first), tracks, header.
export const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const on = (delta: number, pitch: number, vel = 64, ch = 0) => [...vlq(delta), 0x90 | ch, pitch, vel];
export const off = (delta: number, pitch: number, ch = 0) => [...vlq(delta), 0x80 | ch, pitch, 0];
export const offVel0 = (delta: number, pitch: number, ch = 0) => on(delta, pitch, 0, ch);
export const running = (delta: number, ...data: number[]) => [...vlq(delta), ...data]; // no status byte
export const tempo = (delta: number, bpm: number) => [...vlq(delta), 0xff, 0x51, 3, ...u32(Math.round(60_000_000 / bpm)).slice(1)];
export const timeSig = (delta: number, nn: number, ddPower: number) => [...vlq(delta), 0xff, 0x58, 4, nn, ddPower, 24, 8];
export const trackName = (delta: number, text: string) => [...vlq(delta), 0xff, 0x03, text.length, ...ascii(text)];
export const sysex = (delta: number, ...data: number[]) => [...vlq(delta), 0xf0, ...vlq(data.length + 1), ...data, 0xf7];
export const meta = (delta: number, type: number, ...data: number[]) => [...vlq(delta), 0xff, type, ...vlq(data.length), ...data];
export const endOfTrack = (delta = 0) => [...vlq(delta), 0xff, 0x2f, 0];

export const chunk = (type: string, body: number[]) => [...ascii(type), ...u32(body.length), ...body];
export const track = (...events: number[][]) => chunk("MTrk", events.flat());
export const header = (format: number, ntrks: number, division: number) => chunk("MThd", [...u16(format), ...u16(ntrks), ...u16(division)]);

// A whole file. Pass tracks built with track(); the track count is filled in.
export function midiFile(tracks: number[][], { format = 1, division = 480 }: { format?: number; division?: number } = {}): Uint8Array {
  return new Uint8Array([...header(format, tracks.length, division), ...tracks.flat()]);
}

// A note of `beats` quarter notes (480 ticks each) after `gap` ticks.
export const note = (pitch: number, beats = 1, gap = 0, ch = 0) => [on(gap, pitch, 64, ch), off(Math.round(beats * 480), pitch, ch)];
