import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { config } from "@/proxy";

const publicFile = (name: string) => path.join(process.cwd(), "public", name);

describe("manifest", () => {
  const manifest = JSON.parse(readFileSync(publicFile("manifest.webmanifest"), "utf-8"));

  it("has what browsers need to offer installing, with icons that exist", () => {
    expect(manifest).toMatchObject({ name: expect.any(String), short_name: expect.any(String), start_url: "/", display: "standalone" });
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(publicFile(icon.src.slice(1)))).toBe(true);
    expect(existsSync(publicFile("apple-touch-icon.png"))).toBe(true);
  });

  it("and the icons load without a session", () => {
    const matches = (p: string) => new RegExp(`^${config.matcher[0]}$`).test(p);
    for (const p of ["/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png", "/sw.js"]) expect(matches(p)).toBe(false);
  });
});

describe("service worker", () => {
  // Run public/sw.js against a fake worker scope and collect its event handlers.
  function load(windows: { url: string; focus: () => unknown }[] = []) {
    const handlers: Record<string, (event: unknown) => void> = {};
    const self = {
      addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn),
      skipWaiting: vi.fn(),
      registration: { showNotification: vi.fn(async () => {}) },
      clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => {}) },
    };
    new Function("self", readFileSync(publicFile("sw.js"), "utf-8"))(self);
    return { handlers, self };
  }
  const event = (extra: object) => {
    const waits: Promise<unknown>[] = [];
    return { waits, waitUntil: (p: Promise<unknown>) => void waits.push(p), ...extra };
  };

  it("takes over at once when installed", () => {
    const { handlers, self } = load();
    handlers.install({});
    handlers.activate(event({}));
    expect(self.skipWaiting).toHaveBeenCalled();
    expect(self.clients.claim).toHaveBeenCalled();
  });

  it("never intercepts page requests", () => {
    expect(load().handlers.fetch).toBeUndefined();
  });

  it("shows a pushed reminder", () => {
    const { handlers, self } = load();
    const e = event({ data: { json: () => ({ title: "Gym", body: "In 5 min", tag: "k" }) } });
    handlers.push(e);
    expect(e.waits).toHaveLength(1);
    expect(self.registration.showNotification).toHaveBeenCalledWith("Gym", { body: "In 5 min", tag: "k", icon: "/icon-192.png" });
  });

  it("still shows something for an unreadable push", () => {
    const { handlers, self } = load();
    handlers.push(event({ data: null }));
    expect(self.registration.showNotification).toHaveBeenCalledWith("Daily Planner", expect.anything());
  });

  it("focuses an open planner on click, or opens one", async () => {
    const focus = vi.fn();
    const open = load([{ url: "https://x.test/discover", focus: vi.fn() }, { url: "https://x.test/todos", focus }]);
    const close = vi.fn();
    const e1 = event({ notification: { close } });
    open.handlers.notificationclick(e1);
    await Promise.all(e1.waits);
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(open.self.clients.openWindow).not.toHaveBeenCalled();

    const none = load([{ url: "https://x.test/discover", focus: vi.fn() }]);
    const e2 = event({ notification: { close } });
    none.handlers.notificationclick(e2);
    await Promise.all(e2.waits);
    expect(none.self.clients.openWindow).toHaveBeenCalledWith("/todos");
  });
});
