// Record and replay your own run. A run's note-ons and note-offs (keyboard and on-screen keys, MIDI event times on
// the performance.now() clock) become notes [startMs, pitch, velocity, durMs] from the run's start. Only the last run
// is kept, on this device only: localStorage `reel-radar-piano-last-run` (not synced, not in DOC_KEY), so it costs no
// storage or sync. Replay sends the notes back through midi.play, so they sound on the keyboard (or the synth).
export type RecNote = [number, number, number, number]; // start ms, pitch, velocity, duration ms
export type Recording = { songId: string; title: string; at: number; notes: RecNote[] };

export const MAX_REC_NOTES = 5000; // a long song played twice over; more is dropped
export const MAX_REC_MS = 30 * 60_000;
const KEY = "reel-radar-piano-last-run";

export type Recorder = { t0: number; open: Map<number, number>; notes: RecNote[] };
export const startRecorder = (t0: number): Recorder => ({ t0, open: new Map(), notes: [] });

// Feed every note event of the run. A note-off closes that key's open note.
export function recordEvent(r: Recorder, e: { type: "on" | "off"; note: number; velocity: number; time: number }) {
  const t = Math.max(0, Math.round(e.time - r.t0));
  if (e.type === "off") {
    const i = r.open.get(e.note);
    if (i !== undefined) {
      r.notes[i][3] = Math.max(1, t - r.notes[i][0]);
      r.open.delete(e.note);
    }
    return;
  }
  if (r.notes.length >= MAX_REC_NOTES || t > MAX_REC_MS) return;
  const prev = r.open.get(e.note);
  if (prev !== undefined) r.notes[prev][3] = Math.max(1, t - r.notes[prev][0]); // struck again before its note-off
  r.open.set(e.note, r.notes.length);
  r.notes.push([t, e.note, Math.max(1, Math.min(127, Math.round(e.velocity))), 0]);
}

// The run's notes; keys still held at the end last until `end`.
export function finishRecorder(r: Recorder, end: number): RecNote[] {
  const t = Math.max(0, Math.round(end - r.t0));
  for (const i of r.open.values()) r.notes[i][3] = Math.max(1, t - r.notes[i][0]);
  r.open.clear();
  return r.notes.map((n) => [...n] as RecNote);
}

export const recordingMs = (notes: readonly RecNote[]) => notes.reduce((m, n) => Math.max(m, n[0] + n[3]), 0);

export function saveRecording(rec: Recording) {
  if (!rec.notes.length) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    // storage full or blocked: there is just no replay
  }
}

const isNote = (n: unknown): n is RecNote =>
  Array.isArray(n) && n.length === 4 && n.every((x) => typeof x === "number" && Number.isFinite(x)) && n[0] >= 0 && n[0] <= MAX_REC_MS && n[1] >= 0 && n[1] <= 127 && n[3] > 0;

// The last run, when it was of `songId` (any song when omitted) and is well formed.
export function loadRecording(songId?: string): Recording | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<Recording> | null;
    if (!v || typeof v.songId !== "string" || (songId !== undefined && v.songId !== songId) || !Array.isArray(v.notes)) return null;
    const notes = v.notes.filter(isNote).slice(0, MAX_REC_NOTES);
    if (!notes.length) return null;
    return { songId: v.songId, title: typeof v.title === "string" ? v.title : "", at: typeof v.at === "number" ? v.at : 0, notes };
  } catch {
    return null;
  }
}
