import { credentialsMatch } from "@/lib/auth";
import { flushUsage } from "@/lib/docStore";
import { sendDueReminders } from "@/lib/pushReminders";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const noStore = { "Cache-Control": "no-store" };

// POST /api/push/send, called every minute by an outside scheduler (Vercel Hobby cron only runs
// daily). There's no session here, so proxy.ts skips this path and the secret below is the gate:
// without PUSH_CRON_SECRET set, nothing gets in. The answer holds counts only.
export async function POST(req: Request) {
  const secret = process.env.PUSH_CRON_SECRET;
  if (!secret) return Response.json({ error: "Not configured" }, { status: 503, headers: noStore });
  if (!(await credentialsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`, secret))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  }
  try {
    return Response.json(await sendDueReminders(), { headers: noStore });
  } catch (err) {
    console.error("[Push API] Sending reminders failed", err);
    return Response.json({ error: "Failed to send" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage();
  }
}
