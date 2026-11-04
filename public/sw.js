// Shows reminders pushed by /api/push/send, with the app closed or open. Deliberately has no fetch
// handler: pages hold private data and are never cached here.

const PLANNER = "/todos";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data.json();
  } catch {
    // Browsers require every push to show something, so an unreadable one still does.
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "Daily Planner", {
      body: message.body,
      tag: message.tag,
      icon: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname === PLANNER);
      return open ? open.focus() : self.clients.openWindow(PLANNER);
    })
  );
});
