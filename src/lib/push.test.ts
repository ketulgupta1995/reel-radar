// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { disablePush, enablePush, notify } from "./push";
import { requests, routeFetch } from "@/test/pages";
import { jsonResponse } from "@/test/fixtures";

const sub = (endpoint = "https://fcm.googleapis.com/x") => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  unsubscribe: vi.fn(async () => true),
});

function stubWorker(existing: ReturnType<typeof sub> | null = null) {
  const subscribe = vi.fn(async (_opts: { applicationServerKey: Uint8Array }) => sub("https://fcm.googleapis.com/new"));
  const reg = {
    pushManager: { getSubscription: vi.fn(async () => existing), subscribe },
    showNotification: vi.fn(async (_title: string, _opts: NotificationOptions) => {}),
  };
  const worker = { register: vi.fn(async (_url: string) => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg as typeof reg | undefined) };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: worker });
  vi.stubGlobal("PushManager", class {});
  return { reg, worker, subscribe };
}

afterEach(() => {
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (window as unknown as { PushManager?: unknown }).PushManager;
});

describe("enablePush", () => {
  it("reports false, with no requests, in a browser without push", async () => {
    const fetchMock = routeFetch();
    expect(await enablePush(5)).toBe(false);
    await disablePush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("subscribes with the server's key, then saves the lead and time zone", async () => {
    const { worker, subscribe } = stubWorker();
    const fetchMock = routeFetch({ "/api/push": { publicKey: "AQ-_" } });
    expect(await enablePush(10)).toBe(true);
    expect(worker.register).toHaveBeenCalledWith("/sw.js");
    const { applicationServerKey } = subscribe.mock.calls[0][0];
    expect(Array.from(applicationServerKey)).toEqual([0x01, 0x0f, 0xbf]);
    const post = requests(fetchMock, "/api/push").find((r) => r.init?.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toEqual({
      subscription: { endpoint: "https://fcm.googleapis.com/new", keys: { p256dh: "p", auth: "a" } },
      lead: 10,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("reuses an existing subscription without asking for the key", async () => {
    const { subscribe } = stubWorker(sub());
    const fetchMock = routeFetch();
    expect(await enablePush(5)).toBe(true);
    expect(subscribe).not.toHaveBeenCalled();
    expect(requests(fetchMock, "/api/push").map((r) => r.init?.method)).toEqual(["POST"]);
  });

  it("reports false when the server has no push, can't save, or the browser refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubWorker();
    routeFetch({ "/api/push": () => jsonResponse({}, { status: 503 }) });
    expect(await enablePush(5)).toBe(false);

    stubWorker(sub());
    routeFetch({ "/api/push": () => jsonResponse({}, { status: 500 }) });
    expect(await enablePush(5)).toBe(false);

    const { subscribe } = stubWorker();
    routeFetch({ "/api/push": { publicKey: "AQAB" } });
    subscribe.mockRejectedValueOnce(new Error("denied"));
    expect(await enablePush(5)).toBe(false);
  });
});

describe("enablePush when the browser never answers", () => {
  it("gives up after a while, so the page can fall back", async () => {
    const { subscribe } = stubWorker();
    routeFetch({ "/api/push": { publicKey: "AQAB" } });
    subscribe.mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    const result = enablePush(5);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(false);
    vi.useRealTimers();
  });
});

describe("disablePush", () => {
  it("unsubscribes and tells the server", async () => {
    const existing = sub();
    stubWorker(existing);
    const fetchMock = routeFetch();
    await disablePush();
    expect(existing.unsubscribe).toHaveBeenCalled();
    const del = requests(fetchMock, "/api/push")[0];
    expect(del.init?.method).toBe("DELETE");
    expect(JSON.parse(del.init!.body as string)).toEqual({ endpoint: existing.endpoint });
  });

  it("does nothing when this device isn't subscribed", async () => {
    stubWorker();
    const fetchMock = routeFetch();
    await disablePush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const existing = sub();
    existing.unsubscribe.mockRejectedValueOnce(new Error("no"));
    stubWorker(existing);
    routeFetch();
    await expect(disablePush()).resolves.toBeUndefined();
  });
});

describe("notify", () => {
  const direct = () => {
    const sent: string[] = [];
    vi.stubGlobal(
      "Notification",
      class {
        constructor(title: string) {
          sent.push(title);
        }
      }
    );
    return sent;
  };

  it("uses the service worker when one is registered", async () => {
    const sent = direct();
    const { reg } = stubWorker();
    notify("Gym", { tag: "t" });
    await vi.waitFor(() => expect(reg.showNotification).toHaveBeenCalled());
    expect(reg.showNotification.mock.calls[0]).toEqual(["Gym", expect.objectContaining({ tag: "t" })]);
    expect(sent).toEqual([]);
  });

  it("falls back to a direct notification", async () => {
    const sent = direct();
    notify("No worker support", {});
    expect(sent).toEqual(["No worker support"]);

    const { worker } = stubWorker();
    worker.getRegistration.mockResolvedValueOnce(undefined);
    notify("Not registered", {});
    await vi.waitFor(() => expect(sent).toContain("Not registered"));

    const { reg } = stubWorker();
    reg.showNotification.mockRejectedValueOnce(new Error("no"));
    notify("Worker failed", {});
    await vi.waitFor(() => expect(sent).toContain("Worker failed"));
  });

  it("survives browsers that refuse direct notifications", () => {
    vi.stubGlobal("Notification", class {
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    });
    expect(() => notify("Gym", {})).not.toThrow();
  });
});
