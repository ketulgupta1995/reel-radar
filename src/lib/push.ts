// The browser side of reminders: installing the service worker (public/sw.js), subscribing this
// device to pushes, and showing notifications. Browsers without these features report false, and
// the planner page falls back to reminding only while it's open.

const pushSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

const toBytes = (base64url: string) =>
  Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const ENABLE_TIMEOUT = 10_000; // ms; a browser that can't reach its push service may never answer

// Subscribe this device, or bring the server's copy up to date (a changed lead, time zone, or a
// subscription the browser replaced). Resolves to whether pushes will reach this device.
export function enablePush(lead: number): Promise<boolean> {
  if (!pushSupported()) return Promise.resolve(false);
  return Promise.race([subscribe(lead), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ENABLE_TIMEOUT))]);
}

async function subscribe(lead: number): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const res = await fetch("/api/push");
      if (!res.ok) return false;
      const { publicKey } = await res.json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) });
    }
    const saved = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), lead, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    return saved.ok;
  } catch (err) {
    console.error("[Push] Could not subscribe this device", err);
    return false;
  }
}

// Stop pushes to this device. Never throws: logging out mustn't depend on it.
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const { endpoint } = sub;
    await sub.unsubscribe();
    await fetch("/api/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch (err) {
    console.error("[Push] Could not unsubscribe this device", err);
  }
}

function showDirectly(title: string, options: NotificationOptions): void {
  try {
    new Notification(title, options);
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

// Show a notification from the page, through the service worker where there is one, because some
// mobile browsers refuse the direct way.
export function notify(title: string, options: NotificationOptions): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return showDirectly(title, options);
  navigator.serviceWorker
    .getRegistration()
    .then((reg) => (reg ? reg.showNotification(title, { icon: "/icon-192.png", ...options }) : showDirectly(title, options)))
    .catch(() => showDirectly(title, options));
}

// How long before each block this device reminds you, kept in this browser (both planners share it).
const REMINDER_KEY = "reel-radar-reminder-lead"; // minutes before a block starts; unset = off

export function loadReminderLead(): number | null {
  try {
    const v = localStorage.getItem(REMINDER_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

export function saveReminderLead(lead: number | null): void {
  try {
    if (lead === null) localStorage.removeItem(REMINDER_KEY);
    else localStorage.setItem(REMINDER_KEY, String(lead));
  } catch {
    // Storage unavailable: the setting just won't persist.
  }
}
