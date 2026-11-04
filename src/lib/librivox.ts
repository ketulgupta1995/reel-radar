// LibriVox: volunteer recordings of public-domain books. Search and section lists come through our
// /api/books/librivox route (LibriVox's API can't be called from the browser); the audio itself plays
// straight from archive.org.

export type Recording = {
  id: string;
  title: string;
  authors: string[];
  language: string;
  duration: string; // "13:06:44"
  seconds: number;
  readers: string[];
  sectionCount: number;
  sections?: Section[];
};
export type Section = { title: string; url: string; seconds: number };

const DOWN = "Couldn't reach LibriVox. Try again in a moment.";

async function ask(query: string): Promise<Recording[]> {
  const res = await fetch(`/api/books/librivox?${query}`, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
  if (!res) throw new Error(DOWN);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error || DOWN);
  return body.recordings ?? [];
}

export const searchRecordings = (title: string, author: string) =>
  ask(`title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`);

/** The sections of one recording. */
export async function loadSections(id: string): Promise<Section[]> {
  return (await ask(`id=${encodeURIComponent(id)}`))[0]?.sections ?? [];
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
