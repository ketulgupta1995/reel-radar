import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { ConflictError } from "@/lib/docStore";

// The doc store runs on local files in a temp dir, so the real data/ is never touched.
let tmp: string;
const SECRET = "cron-secret";
const NOON_UTC = Date.UTC(2026, 2, 2, 12, 0); // 5:30 PM on Monday 2026-03-02 in Kolkata
const DAY = "2026-03-02";
const MONTH_FILE = "planner-2026-03.json";
const SUBS_FILE = "push-subscriptions.json";

function newDevice(host = "fcm.googleapis.com") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const endpoint = `https://${host}/send/${randomBytes(4).toString("hex")}`;
  return {
    ecdh,
    auth,
    endpoint,
    subscription: { endpoint, keys: { p256dh: ecdh.getPublicKey("base64url"), auth: auth.toString("base64url") } },
  };
}
type Device = ReturnType<typeof newDevice>;

// What the browser does with a push: undo RFC 8291, proving the message can be read at the other end.
function open(body: Uint8Array, device: Device) {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const serverPublic = buf.subarray(21, 86);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), device.ecdh.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", device.ecdh.computeSecret(serverPublic), device.auth, info, 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12));
  const cipher = buf.subarray(86);
  const d = createDecipheriv("aes-128-gcm", key, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}

const writeData = async (file: string, doc: unknown) => {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true });
  await fs.writeFile(path.join(tmp, "data", file), JSON.stringify(doc));
};
const readData = async (file: string) => JSON.parse(await fs.readFile(path.join(tmp, "data", file), "utf-8"));
const monthWith = (...todos: object[]) => ({
  items: todos.map((todo, pos) => ({ date: DAY, pos, updatedAt: 1, todo: { completed: false, createdAt: "", ...todo } })),
});

const json = (body: unknown, method = "POST") => new Request("http://localhost/api/push", { method, body: JSON.stringify(body) });
const cronReq = (auth?: string) =>
  new Request("http://localhost/api/push/send", { method: "POST", headers: auth ? { authorization: auth } : {} });

let push: typeof import("./push/route");
let send: typeof import("./push/send/route");
let fetchMock: ReturnType<typeof vi.fn>;

const addDevice = async (device: Device, lead = 5, timeZone = "Asia/Kolkata") => {
  const res = await push.POST(json({ subscription: device.subscription, lead, timeZone }));
  expect(res.status).toBe(200);
};
const runCron = async () => {
  const res = await send.POST(cronReq(`Bearer ${SECRET}`));
  expect(res.status).toBe(200);
  return res.json();
};
const pushedTo = (device: Device) =>
  fetchMock.mock.calls.filter(([url]) => url === device.endpoint).map(([, init]) => open(init.body, device));

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-radar-push-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("TURSO_DATABASE_URL", "");
  const c = createECDH("prime256v1");
  c.generateKeys();
  vi.stubEnv("VAPID_PUBLIC_KEY", c.getPublicKey("base64url"));
  vi.stubEnv("VAPID_PRIVATE_KEY", c.getPrivateKey("base64url"));
  vi.stubEnv("VAPID_SUBJECT", "mailto:me@example.com");
  vi.stubEnv("PUSH_CRON_SECRET", SECRET);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON_UTC);
  fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  push = await import("./push/route");
  send = await import("./push/send/route");
});
afterEach(async () => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/docStore");
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("/api/push", () => {
  it("serves the public key, never the private one", async () => {
    const body = await (await push.GET()).json();
    expect(body).toEqual({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  it("answers 503 when push isn't configured", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect((await push.GET()).status).toBe(503);
    expect((await push.POST(json({}))).status).toBe(503);
  });

  it("stores a device, and updating it keeps what was already sent", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "Call", start: 17 * 60 + 33 }));
    await runCron();
    await addDevice(device, 10, "Europe/Paris");
    const { subs } = await readData(SUBS_FILE);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ lead: 10, timeZone: "Europe/Paris", sent: [`${DAY}:a:${17 * 60 + 33}`] });
  });

  it("writes nothing when a device re-sends the same settings", async () => {
    const device = newDevice();
    await addDevice(device);
    const before = await fs.stat(path.join(tmp, "data", SUBS_FILE));
    vi.setSystemTime(NOON_UTC + 60_000);
    await addDevice(device);
    expect((await fs.stat(path.join(tmp, "data", SUBS_FILE))).mtimeMs).toBe(before.mtimeMs);
  });

  it("keeps only the newest devices", async () => {
    for (let i = 0; i < 12; i++) await addDevice(newDevice());
    expect((await readData(SUBS_FILE)).subs).toHaveLength(10);
  });

  it.each([
    ["an endpoint that isn't a push service", { endpoint: "https://evil.example/x" }],
    ["a look-alike host", { endpoint: "https://fcm.googleapis.com.evil.example/x" }],
    ["plain http", { endpoint: "http://fcm.googleapis.com/x" }],
    ["an internal port", { endpoint: "https://fcm.googleapis.com:8443/x" }],
    ["credentials in the URL", { endpoint: "https://me:pw@fcm.googleapis.com/x" }],
    ["a malformed URL", { endpoint: "not a url" }],
    ["a very long endpoint", { endpoint: `https://fcm.googleapis.com/${"x".repeat(1100)}` }],
    ["a bad key", { keys: { p256dh: "short", auth: "AAAA" } }],
    ["a bad lead", { lead: 7 }],
    ["a bad time zone", { timeZone: "Mars/Olympus" }],
    ["no time zone", { timeZone: 5 }],
  ])("rejects %s", async (_name, change: { endpoint?: string; keys?: object; lead?: number; timeZone?: unknown }) => {
    const { subscription } = newDevice();
    const res = await push.POST(
      json({
        subscription: { ...subscription, ...(change.endpoint ? { endpoint: change.endpoint } : {}), ...(change.keys ? { keys: change.keys } : {}) },
        lead: change.lead ?? 5,
        timeZone: "timeZone" in change ? change.timeZone : "Asia/Kolkata",
      })
    );
    expect(res.status).toBe(400);
  });

  it("accepts the other browsers' push services", async () => {
    for (const host of ["updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) await addDevice(newDevice(host));
    expect((await readData(SUBS_FILE)).subs).toHaveLength(3);
  });

  it("removes a device, and rejects a delete without an endpoint", async () => {
    const device = newDevice();
    await addDevice(device);
    expect((await push.DELETE(json({}, "DELETE"))).status).toBe(400);
    expect((await push.DELETE(new Request("http://localhost/api/push", { method: "DELETE", body: "nope" }))).status).toBe(400);
    expect((await push.DELETE(json({ endpoint: device.endpoint }, "DELETE"))).status).toBe(200);
    expect((await readData(SUBS_FILE)).subs).toEqual([]);
  });

  it("answers 500 when the store fails", async () => {
    await fs.writeFile(path.join(tmp, "data"), "a file where the folder should be");
    expect((await push.POST(json({ subscription: newDevice().subscription, lead: 5, timeZone: "Asia/Kolkata" }))).status).toBe(500);
  });

  it("answers 500 when a delete can't be saved", async () => {
    const device = newDevice();
    await addDevice(device);
    await fs.chmod(path.join(tmp, "data", SUBS_FILE), 0o400);
    const res = await push.DELETE(json({ endpoint: device.endpoint }, "DELETE"));
    await fs.chmod(path.join(tmp, "data", SUBS_FILE), 0o600);
    expect(res.status).toBe(500);
  });
});

describe("/api/push/send", () => {
  it("refuses a wrong or missing secret and stays shut when none is set", async () => {
    await addDevice(newDevice());
    expect((await send.POST(cronReq())).status).toBe(401);
    expect((await send.POST(cronReq("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("PUSH_CRON_SECRET", "");
    expect((await send.POST(cronReq("Bearer "))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing, and reads no planner docs, without devices", async () => {
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "Call", start: 17 * 60 + 33 }));
    expect(await runCron()).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing when push isn't configured", async () => {
    await addDevice(newDevice());
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(await runCron()).toEqual({ sent: 0, failed: 0, removed: 0 });
  });

  it("reminds in the device's own time zone, once, and answers with counts only", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData(
      MONTH_FILE,
      monthWith(
        { id: "soon", text: "Call Sam", note: "room 4", start: 17 * 60 + 33, duration: 30 },
        { id: "later", text: "Later", start: 19 * 60 },
        { id: "done", text: "Done", start: 17 * 60 + 33, completed: true },
        { id: "free", text: "No time" }
      )
    );
    const res = await runCron();
    expect(res).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(pushedTo(device)).toEqual([{ title: "Call Sam", body: "In 3 min · 5:33 PM–6:03 PM\nroom 4", tag: `${DAY}:soon:${17 * 60 + 33}` }]);
    await runCron();
    expect(pushedTo(device)).toHaveLength(1);
  });

  it("uses each device's lead and time zone", async () => {
    const india = newDevice();
    const paris = newDevice();
    await addDevice(india, 15, "Asia/Kolkata");
    await addDevice(paris, 0, "Europe/Paris"); // 1 PM there
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "India", start: 17 * 60 + 40 }, { id: "b", text: "Paris", start: 13 * 60 }));
    await runCron();
    expect(pushedTo(india).map((m) => m.title)).toEqual(["India"]);
    expect(pushedTo(paris).map((m) => m.title)).toEqual(["Paris"]);
  });

  it("still reminds shortly after the start when a run was missed", async () => {
    const device = newDevice();
    await addDevice(device, 0);
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "Call", start: 17 * 60 + 27 }));
    await runCron();
    expect(pushedTo(device)[0].body).toMatch(/^Started 3 min ago/);
  });

  it("works out repeating tasks for a day the planner hasn't been opened", async () => {
    const device = newDevice();
    await addDevice(device);
    const start = 17 * 60 + 33;
    await writeData("planner-daily.json", {
      items: [
        { updatedAt: 1, task: { id: "walk", text: "Walk", note: "shoes", startDate: "2026-01-01", start } },
        { updatedAt: 1, task: { id: "skipped", text: "Skipped", startDate: "2026-01-01", start, skipDates: [DAY] } },
        { updatedAt: 1, task: { id: "tue", text: "Tuesdays", startDate: "2026-01-01", start, days: [2] } },
        { updatedAt: 1, task: { id: "free", text: "Unscheduled", startDate: "2026-01-01" } },
      ],
    });
    await runCron();
    expect(pushedTo(device)).toEqual([expect.objectContaining({ title: "Walk", tag: `${DAY}:walk:${DAY}:${start}` })]);
  });

  it("handles every-N-days, monthly and times-a-week tasks on days the planner wasn't opened", async () => {
    const device = newDevice();
    await addDevice(device);
    const start = 17 * 60 + 33;
    const task = (id: string, extra: object) => ({ updatedAt: 1, task: { id, text: id, startDate: "2026-02-26", start, ...extra } });
    await writeData("planner-daily.json", {
      items: [
        task("every2", { every: 2 }), // Feb 26 + 4 days = Mar 2
        task("every3", { every: 3 }),
        task("second", { monthDay: 2 }),
        task("third", { monthDay: 3 }),
        task("flex", { timesPerWeek: 1 }),
        task("flexdone", { timesPerWeek: 1, doneDates: ["2026-03-03"] }),
      ],
    });
    await runCron();
    expect(pushedTo(device).map((m) => m.title).sort()).toEqual(["every2", "flex", "second"]);
  });

  it("stops a times-a-week task once that week's finished copies meet the target", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData("planner-daily.json", { items: [{ updatedAt: 1, task: { id: "run", text: "Run", startDate: "2026-01-01", start: 17 * 60 + 33, timesPerWeek: 1 } }] });
    await writeData(MONTH_FILE, { items: [{ date: "2026-03-04", pos: 0, updatedAt: 1, todo: { id: "run:2026-03-04", dailyId: "run", text: "Run", completed: true, createdAt: "" } }] });
    expect((await runCron()).sent).toBe(0);
  });

  it("uses the day's copy of a repeating task instead of the template", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData("planner-daily.json", { items: [{ updatedAt: 1, task: { id: "walk", text: "Walk", startDate: "2026-01-01", start: 17 * 60 + 33 } }] });
    await writeData(MONTH_FILE, monthWith({ id: `walk:${DAY}`, dailyId: "walk", text: "Walk", start: 17 * 60 + 33, completed: true }));
    expect((await runCron()).sent).toBe(0);
  });

  it("drops a device the browser has abandoned", async () => {
    const dead = newDevice();
    const live = newDevice();
    await addDevice(dead);
    await addDevice(live);
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "Call", start: 17 * 60 + 33 }));
    fetchMock.mockImplementation(async (url: string) => new Response(null, { status: url === dead.endpoint ? 410 : 201 }));
    expect(await runCron()).toEqual({ sent: 1, failed: 0, removed: 1 });
    expect((await readData(SUBS_FILE)).subs.map((s: { endpoint: string }) => s.endpoint)).toEqual([live.endpoint]);
  });

  it("tries a failed send again on the next run, keeping task text out of the logs", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "Private task", start: 17 * 60 + 33 }));
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 500 }));
    expect(await runCron()).toEqual({ sent: 0, failed: 1, removed: 0 });
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("network down");
    });
    expect(await runCron()).toEqual({ sent: 0, failed: 1, removed: 0 });
    expect(await runCron()).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/Private task|send\//);
  });

  it("clears yesterday's sent list when something new goes out", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData(SUBS_FILE, { subs: [{ ...(await readData(SUBS_FILE)).subs[0], sent: ["2026-03-01:old:600", `${DAY}:kept:60`] }] });
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "Call", start: 17 * 60 + 33 }));
    await runCron();
    expect((await readData(SUBS_FILE)).subs[0].sent).toEqual([`${DAY}:kept:60`, `${DAY}:a:${17 * 60 + 33}`]);
  });

  it("clips long text so the message fits", async () => {
    const device = newDevice();
    await addDevice(device);
    await writeData(MONTH_FILE, monthWith({ id: "a", text: "x".repeat(500), note: "y".repeat(5000), start: 17 * 60 + 33 }));
    await runCron();
    const [m] = pushedTo(device);
    expect(m.title).toHaveLength(120);
    expect(m.body).toHaveLength(300);
  });

  it("answers 500 when the store can't be read, without saying why", async () => {
    await addDevice(newDevice());
    await fs.writeFile(path.join(tmp, "data", MONTH_FILE), "not json");
    const res = await send.POST(cronReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to send" });
  });
});

describe("writes racing each other", () => {
  async function withConflicts(conflicts: number) {
    vi.resetModules();
    let left = conflicts;
    const writeDoc = vi.fn(async () => {
      if (left-- > 0) throw new ConflictErrorInModule();
      return '"e"';
    });
    let ConflictErrorInModule: typeof ConflictError = ConflictError;
    vi.doMock("@/lib/docStore", async (original) => {
      const real = await original<typeof import("@/lib/docStore")>();
      ConflictErrorInModule = real.ConflictError;
      return { ...real, writeDoc };
    });
    const { saveSubscription, parseSubscription } = await import("@/lib/pushReminders");
    const sub = parseSubscription({ subscription: newDevice().subscription, lead: 5, timeZone: "Asia/Kolkata" })!;
    return { writeDoc, save: () => saveSubscription(sub) };
  }

  it("re-reads and retries when another write got in first", async () => {
    const { writeDoc, save } = await withConflicts(2);
    await save();
    expect(writeDoc).toHaveBeenCalledTimes(3);
  });

  it("gives up after three tries", async () => {
    const { writeDoc, save } = await withConflicts(5);
    await expect(save()).rejects.toThrow();
    expect(writeDoc).toHaveBeenCalledTimes(3);
  });
});
