import { cachedJson } from "@/lib/http";

// GET /api/books/librivox?title=<title>&author=<author>  -> { recordings }, without their sections
// GET /api/books/librivox?id=<number>                    -> { recordings: [one, with its sections] }
// LibriVox's API can't be called from the browser (no cross-origin access), so this asks it. The audio
// itself streams from archive.org straight to the browser; only archive.org addresses are passed on.
export const maxDuration = 10;

const API = "https://librivox.org/api/feed/audiobooks/";
const TIMEOUT_MS = 8000;
const MAX_RECORDINGS = 8;
const DAY = 24 * 60 * 60;
const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

type Raw = {
  id?: unknown;
  title?: unknown;
  language?: unknown;
  totaltime?: unknown;
  totaltimesecs?: unknown;
  authors?: { first_name?: string; last_name?: string }[];
  sections?: { title?: string; listen_url?: string; playtime?: string; readers?: { display_name?: string }[] }[];
};

// Only https addresses on archive.org, where LibriVox keeps its audio.
function audioUrl(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && (u.hostname === "archive.org" || u.hostname.endsWith(".archive.org")) ? u.href : null;
  } catch {
    return null;
  }
}

function shape(b: Raw, withSections: boolean) {
  const sections = (b.sections ?? []).flatMap((s) => {
    const url = audioUrl(s.listen_url);
    return url ? [{ title: String(s.title ?? "").trim() || "Section", url, seconds: Number(s.playtime) || 0 }] : [];
  });
  const readers = [...new Set((b.sections ?? []).flatMap((s) => (s.readers ?? []).map((r) => r.display_name?.trim() ?? "")).filter(Boolean))];
  return {
    id: String(b.id),
    title: String(b.title ?? "").trim(),
    authors: (b.authors ?? []).map((a) => `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim()).filter(Boolean),
    language: String(b.language ?? ""),
    duration: String(b.totaltime ?? ""),
    seconds: Number(b.totaltimesecs) || 0,
    readers: readers.slice(0, 3),
    sectionCount: sections.length,
    ...(withSections && { sections }),
  };
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const id = p.get("id");
  const title = (p.get("title") ?? "").trim();
  const author = (p.get("author") ?? "").toLowerCase();

  let upstream: string;
  if (id !== null) {
    if (!/^\d{1,7}$/.test(id)) return fail("Invalid recording number", 400);
    upstream = `${API}?id=${id}&format=json&extended=1`;
  } else if (title && title.length <= 200) {
    upstream = `${API}?title=${encodeURIComponent("^" + title)}&format=json&extended=1&limit=${MAX_RECORDINGS}`;
  } else {
    return fail("Give a title or a recording number", 400);
  }

  const res = await fetch(upstream, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (!res) return fail("Couldn't reach LibriVox. Try again in a moment.", 502);
  if (res.status === 404) return cachedJson({ recordings: [] }, DAY); // LibriVox answers 404 when nothing matches
  if (!res.ok) return fail("Couldn't reach LibriVox. Try again in a moment.", 502);
  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.books)) return fail("LibriVox sent something unexpected. Try again later.", 502);

  // Recordings by the book's author (matched on surname) first: a title alone can match unrelated books.
  const byAuthor = (b: Raw) => (b.authors ?? []).some((a) => !!a.last_name && author.includes(a.last_name.toLowerCase()));
  const raw = [...(data.books as Raw[])];
  if (author) raw.sort((a, b) => Number(byAuthor(b)) - Number(byAuthor(a)));
  const recordings = raw.map((b) => shape(b, id !== null)).filter((r) => r.sectionCount > 0);
  return cachedJson({ recordings }, DAY);
}
