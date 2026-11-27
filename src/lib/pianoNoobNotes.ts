// NoobNotes import (pure). A noobnotes.net song page gives letter names only: "^" is the octave above the
// middle one, "." the octave below, notes joined by "-" are played quickly together, "~" is a held note.
// There is no rhythm and no left hand, so the timing here is made up: a note is one beat, joined notes are
// half a beat each, and the last note of a line gets one extra beat. Lyrics are read past and never kept.
import { suggestFingering } from "./pianoFingering";
import { MAX_NOTES } from "./pianoMidiFile";
import { cleanTitle } from "./pianoSongImport";
import { Song, SongNote, parsePitch, sortNotes } from "./pianoSongs";

export const NOOB_BPM = 90;
export type NoobPage = { title: string; lines: string[] }; // lines: the note lines only

// The link if it is a noobnotes.net page, else undefined. The server fetches nothing else.
export function noobUrl(input: string): URL | undefined {
  const text = input.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^(www\.)?noobnotes\.net$/.test(u.hostname) || u.port || u.username || u.password || u.pathname === "/") return undefined;
    u.protocol = "https:";
    return u;
  } catch {
    return undefined;
  }
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "’", lsquo: "‘", hellip: "…" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? all;
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
const textOf = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ""));

const NOTE = /^(\^{0,2}|\.{0,2})([A-G])([#b]?)$/;

// A line's words, each a list of joined notes; undefined when the line isn't all notes (a lyric).
function wordsOf(line: string): string[][] | undefined {
  const words = line
    .replace(/[♯]/g, "#")
    .replace(/[♭]/g, "b")
    .replace(/[–—]/g, "-")
    .replace(/\([^)]*\)|~|\||,|…|\.{3,}/g, " ")
    .replace(/\s*-\s*/g, "-")
    .split(/\s+/)
    .map((w) => w.split("-").filter(Boolean))
    .filter((w) => w.length);
  return words.length && words.every((w) => w.every((n) => NOTE.test(n))) ? words : undefined;
}

export function parseNoobPage(html: string): NoobPage | undefined {
  const clean = html.replace(/<!--[\s\S]*?-->|<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, "");
  const from = clean.search(/class=["']post-content["']/);
  if (from < 0) return undefined;
  const rest = clean.slice(clean.indexOf(">", from) + 1);
  const end = rest.search(/<\/div>/i);
  const body = end < 0 ? rest : rest.slice(0, end);
  const lines = body
    .replace(/\r?\n/g, " ")
    .split(/<br\s*\/?>|<\/?(?:p|h[1-6]|li|pre)\b[^>]*>/i)
    .map((l) => textOf(l).replace(/\s+/g, " ").trim())
    .filter((l) => wordsOf(l));
  if (!lines.length) return undefined;
  const h1 = /<h1[^>]*entry-title[^>]*>([\s\S]*?)<\/h1>/i.exec(clean)?.[1] ?? "";
  return { title: cleanTitle(textOf(h1)) || "NoobNotes song", lines };
}

export function noobNotes(lines: readonly string[]): { start: number; dur: number; pitch: number }[] {
  const out: { start: number; dur: number; pitch: number }[] = [];
  let at = 0;
  for (const line of lines) {
    const words = wordsOf(line) ?? [];
    for (const word of words) {
      const dur = word.length > 1 ? 0.5 : 1;
      for (const token of word) {
        const [, mark, letter, accidental] = NOTE.exec(token)!;
        const octave = 4 + (mark[0] === "^" ? mark.length : -mark.length);
        out.push({ start: at, dur, pitch: parsePitch(`${letter}${accidental}${octave}`) });
        at += dur;
      }
    }
    if (words.length) {
      out[out.length - 1].dur += 1;
      at = Math.ceil(at + 1); // the next line starts on a whole beat
    }
  }
  return out;
}

// All right hand, with suggested fingering. Undefined when there are no notes or too many.
export function buildNoobSong(lines: readonly string[], id: string, title: string, bpm = NOOB_BPM): Song | undefined {
  const raw = noobNotes(lines);
  if (!raw.length || raw.length > MAX_NOTES) return undefined;
  const fingers = suggestFingering(raw, "R");
  const notes: SongNote[] = raw.map((n, i) => ({ ...n, hand: "R", finger: fingers[i], suggested: true }));
  return { id, title: cleanTitle(title) || "NoobNotes song", bpm, beatsPerBar: 4, level: 0, imported: true, notes: sortNotes(notes) };
}
