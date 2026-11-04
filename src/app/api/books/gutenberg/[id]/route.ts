// GET /api/books/gutenberg/<number>: the no-illustrations EPUB of a Project Gutenberg book. Gutenberg's
// files can't be fetched from the browser (no cross-origin access), so this fetches it. It only ever
// contacts Gutenberg, and only for a book number. Illustrated editions can be 25 MB, over Vercel's
// 4.5 MB response limit, so a book bigger than that is refused with a message instead.
export const maxDuration = 10;

const MAX_BYTES = 4_400_000;
const TIMEOUT_MS = 8000;
const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,7}$/.test(id)) return fail("Invalid book number", 400);

  const res = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.epub`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (!res) return fail("Couldn't reach Project Gutenberg. Try again in a moment.", 502);
  if (res.status === 404) return fail("Project Gutenberg has no EPUB of that book.", 404);
  if (!res.ok) return fail("Couldn't reach Project Gutenberg. Try again in a moment.", 502);

  const tooBig = () => fail("That book is too big to download here (over 4.5 MB). Try the Standard Ebooks edition, or upload your own copy.", 413);
  if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) return tooBig();
  const bytes = await res.arrayBuffer().catch(() => null);
  if (!bytes) return fail("The download was interrupted. Try again.", 502);
  if (bytes.byteLength > MAX_BYTES) return tooBig();

  return new Response(bytes, {
    headers: { "Content-Type": "application/epub+zip", "Cache-Control": "private, max-age=86400" },
  });
}
