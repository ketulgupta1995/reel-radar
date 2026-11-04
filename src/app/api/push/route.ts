import { flushUsage } from "@/lib/docStore";
import { parseSubscription, removeSubscription, saveSubscription } from "@/lib/pushReminders";
import { vapidConfig } from "@/lib/webPush";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const noStore = { "Cache-Control": "no-store" };

// GET /api/push: the public key a browser needs to subscribe, or 503 when push isn't set up.
export async function GET() {
  const vapid = vapidConfig();
  if (!vapid) return Response.json({ error: "Push isn't configured" }, { status: 503, headers: noStore });
  return Response.json({ publicKey: vapid.publicKey }, { headers: noStore });
}

// POST /api/push { subscription, lead, timeZone }: this device wants reminders.
export async function POST(req: Request) {
  if (!vapidConfig()) return Response.json({ error: "Push isn't configured" }, { status: 503, headers: noStore });
  const sub = parseSubscription(await req.json().catch(() => null));
  if (!sub) return Response.json({ error: "Invalid subscription" }, { status: 400, headers: noStore });
  try {
    await saveSubscription(sub);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (err) {
    console.error("[Push API] Saving a subscription failed", err);
    return Response.json({ error: "Failed to save" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage();
  }
}

// DELETE /api/push { endpoint }: this device no longer wants reminders.
export async function DELETE(req: Request) {
  const { endpoint } = (await req.json().catch(() => null)) ?? {};
  if (typeof endpoint !== "string") return Response.json({ error: "Invalid endpoint" }, { status: 400, headers: noStore });
  try {
    await removeSubscription(endpoint);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (err) {
    console.error("[Push API] Removing a subscription failed", err);
    return Response.json({ error: "Failed to save" }, { status: 500, headers: noStore });
  } finally {
    await flushUsage();
  }
}
