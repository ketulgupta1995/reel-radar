// GET /api/piano/noobnotes?url=<noobnotes.net song page>: the page's title and note lines (no lyrics). The
// browser can't fetch the page itself (no cross-origin access). Only noobnotes.net is ever contacted,
// including after a redirect.
import { noobUrl, parseNoobPage } from "@/lib/pianoNoobNotes";

export const maxDuration = 10;

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });

export async function GET(req: Request) {
  let url = noobUrl(new URL(req.url).searchParams.get("url") ?? "");
  if (!url) return fail("Paste a song link from noobnotes.net.", 400);
  const down = () => fail("Couldn't reach NoobNotes. Try again in a moment.", 502);
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res: Response | null = await fetch(url, { redirect: "manual", signal, cache: "no-store" }).catch(() => null);
    if (!res) return down();
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      url = to ? noobUrl(new URL(to, url).href) : undefined;
      if (!url) return down();
      continue;
    }
    if (res.status === 404) return fail("NoobNotes has no page at that link.", 404);
    if (!res.ok) return down();
    const html = await res.text().catch(() => null);
    if (html === null) return down();
    const page = html.length > MAX_BYTES ? undefined : parseNoobPage(html);
    return page ? Response.json(page, { headers: noStore }) : fail("Couldn't find any notes on that page. Check it's a song page.", 422);
  }
  return down();
}
