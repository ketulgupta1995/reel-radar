import { ConflictError, readDoc, writeDoc, type ReadResult } from "@/lib/docStore";
import { DEFAULT_DURATION, REMINDER_LEADS, dueReminders, missingDailyTasks, reminderBody, reminderKey } from "@/lib/reminders";
import { same } from "@/lib/syncDocs";
import { sendPush, vapidConfig, type PushTarget } from "@/lib/webPush";
import type { DailyTask, Todo } from "@/lib/todos";

// Reminders for when the app is closed. Each device that turned reminders on has an entry in the
// "push-subscriptions" doc (never served by /api/sync, so it stays out of DOC_KEY). An outside
// scheduler calls /api/push/send, which works out from the synced planner docs what is due.

export type PushSub = PushTarget & {
  lead: number; // minutes before a block
  timeZone: string; // the planner's days and times are this device's local ones
  sent: string[]; // reminderKey()s already delivered, kept for the current day
};

const PUSH_DOC = "push-subscriptions";
const MAX_SUBS = 10;
const LATE = 5; // minutes after a block's start a reminder still goes out, for a late or missed run
const TTL = 15 * 60; // seconds a push service keeps trying a device that's offline

// Only the browsers' own push services: this server POSTs to whatever endpoint is stored.
const PUSH_HOST = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

function validTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1024) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && !url.username && PUSH_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

const isKey = (v: unknown, length: number): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v) && Buffer.from(v, "base64url").length === length;

// A device's request to get reminders, checked, or null if anything about it is off.
export function parseSubscription(body: unknown): Omit<PushSub, "sent"> | null {
  const { subscription, lead, timeZone } = (body ?? {}) as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; lead?: unknown; timeZone?: unknown };
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!validEndpoint(endpoint) || !isKey(p256dh, 65) || !isKey(auth, 16)) return null;
  if (typeof lead !== "number" || !REMINDER_LEADS.includes(lead) || !validTimeZone(timeZone)) return null;
  return { endpoint, p256dh, auth, lead, timeZone };
}

async function readSubs(): Promise<{ subs: PushSub[]; etag?: string }> {
  const r = await readDoc(PUSH_DOC);
  return r && "data" in r ? { subs: (r.data as { subs?: PushSub[] }).subs ?? [], etag: r.etag } : { subs: [] };
}

// Apply a change to the latest copy, trying again if a device or a send run wrote first.
// A change that alters nothing costs no write.
async function changeSubs(change: (subs: PushSub[]) => PushSub[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { subs, etag } = await readSubs();
    const next = change(subs);
    if (same(next, subs)) return;
    try {
      await writeDoc(PUSH_DOC, { subs: next }, etag);
      return;
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt === 3) throw err;
    }
  }
}

// Add a device, or update its settings. What it was already sent stays, so nothing fires twice.
export const saveSubscription = (sub: Omit<PushSub, "sent">) =>
  changeSubs((subs) => {
    const old = subs.find((s) => s.endpoint === sub.endpoint);
    if (old) return subs.map((s) => (s === old ? { ...sub, sent: old.sent } : s));
    return [...subs, { ...sub, sent: [] }].slice(-MAX_SUBS);
  });

export const removeSubscription = (endpoint: string) => changeSubs((subs) => subs.filter((s) => s.endpoint !== endpoint));

// The date and minutes since midnight on a device's clock.
export function localClock(timeZone: string, now: number): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const itemsOf = <T>(doc: ReadResult): T[] => (doc && "data" in doc ? ((doc.data as { items?: T[] }).items ?? []) : []);

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A day's scheduled tasks as the server sees them. A repeating task only gets its day's copy when
// the planner is opened, so a day nobody opened yet still has to count those tasks.
function dayTodos(month: { date: string; pos: number; todo: Todo }[], daily: DailyTask[], date: string): Todo[] {
  const todos = month.filter((i) => i.date === date).sort((a, b) => a.pos - b.pos).map((i) => i.todo);
  const copies = missingDailyTasks(daily, todos, date)
    .filter((d) => d.start !== undefined)
    .map((d): Todo => ({
      id: `${d.id}:${date}`, // the id the planner gives this day's copy (loadTodosWithDaily)
      text: d.text,
      completed: false,
      createdAt: date,
      dailyId: d.id,
      start: d.start,
      duration: d.duration ?? DEFAULT_DURATION,
      ...(d.note ? { note: d.note } : {}),
    }));
  return [...todos, ...copies];
}

export type SendResult = { sent: number; failed: number; removed: number };

// Send every reminder that's due and hasn't gone out. Reads the subscriptions, then only if there
// are any, the daily tasks and the current month; writes only after something was sent or a device
// has gone. A failed send isn't recorded, so the next run tries again.
export async function sendDueReminders(now = Date.now()): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, removed: 0 };
  const vapid = vapidConfig();
  if (!vapid) return result;
  const { subs } = await readSubs();
  if (!subs.length) return result;

  const clocks = new Map(subs.map((s) => [s.endpoint, localClock(s.timeZone, now)]));
  const months = Array.from(new Set(Array.from(clocks.values(), (c) => c.date.slice(0, 7))));
  const [daily, ...monthDocs] = await Promise.all([readDoc("planner-daily"), ...months.map((m) => readDoc(`planner-${m}`))]);
  const dailyTasks = itemsOf<{ task: DailyTask }>(daily).map((i) => i.task);
  const monthItems = new Map(months.map((m, i) => [m, itemsOf<{ date: string; pos: number; todo: Todo }>(monthDocs[i])]));

  const delivered = new Map<string, string[]>();
  const gone = new Set<string>();
  await Promise.all(
    subs.map(async (sub) => {
      const { date, minutes } = clocks.get(sub.endpoint)!;
      const todos = dayTodos(monthItems.get(date.slice(0, 7))!, dailyTasks, date);
      for (const t of dueReminders(todos, minutes, sub.lead, LATE)) {
        const tag = reminderKey(date, t);
        if (sub.sent.includes(tag)) continue;
        const message = { title: clip(t.text, 120), body: clip(reminderBody(t, minutes), 300), tag };
        const status = await sendPush(sub, message, vapid, TTL).catch(() => 0);
        if (status === 404 || status === 410) {
          gone.add(sub.endpoint); // the browser dropped this subscription; it will never work again
          result.removed++;
          return;
        }
        if (status >= 200 && status < 300) {
          delivered.set(sub.endpoint, [...(delivered.get(sub.endpoint) ?? []), tag]);
          result.sent++;
        } else {
          // The status only: the endpoint and the task's text stay out of the logs.
          console.error(`[Push] A send failed (${status})`);
          result.failed++;
        }
      }
    })
  );

  if (delivered.size || gone.size) {
    await changeSubs((latest) =>
      latest
        .filter((s) => !gone.has(s.endpoint))
        .map((s) => {
          const tags = delivered.get(s.endpoint);
          if (!tags) return s;
          const today = clocks.get(s.endpoint)!.date;
          return { ...s, sent: [...s.sent.filter((k) => k.startsWith(`${today}:`)), ...tags] };
        })
    );
  }
  return result;
}
