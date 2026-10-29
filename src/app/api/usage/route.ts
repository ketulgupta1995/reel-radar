import { readUsage } from "@/lib/docStore";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const DAYS = 400;

// GET /api/usage
// Database reads and writes per half hour (UTC), as { buckets: [{ t: "2026-10-30T09:30", reads, writes }] },
// for the last year or so. The stats page totals them per local day.
export async function GET() {
  try {
    const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 16);
    const usage = await readUsage(since);
    const buckets = Object.entries(usage)
      .map(([t, b]) => ({ t, ...b }))
      .sort((a, b) => a.t.localeCompare(b.t));
    return Response.json({ buckets }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[Usage API] Read failed", err);
    return Response.json({ error: "Failed to read usage" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
