import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";

// Same setup as sync-route.test.ts: Turso is an in-memory libSQL database, and local files live in
// a temp dir so the real data/ is never touched.
let db: Client;
vi.mock("@libsql/client/web", () => ({ createClient: () => db }));

let tmp: string;
async function load(tursoUrl?: string) {
  vi.stubEnv("TURSO_DATABASE_URL", tursoUrl ?? "");
  vi.resetModules();
  return { sync: await import("./sync/route"), usage: await import("./usage/route") };
}
const getReq = (keys: string) => new Request(`http://localhost/api/sync?keys=${encodeURIComponent(keys)}`);
const post = (body: unknown) => new Request("http://localhost/api/sync", { method: "POST", body: JSON.stringify(body) });
const totals = async (route: { GET: () => Promise<Response> }) => {
  const { buckets } = await (await route.GET()).json();
  return {
    reads: buckets.reduce((n: number, b: { reads: number }) => n + b.reads, 0),
    writes: buckets.reduce((n: number, b: { writes: number }) => n + b.writes, 0),
  };
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-radar-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createClient({ url: ":memory:" });
});
afterEach(async () => {
  vi.useRealTimers();
  db.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("/api/usage with local files", () => {
  it("starts empty, then counts reads that haven't been saved yet", async () => {
    const { sync, usage } = await load();
    expect(await totals(usage)).toEqual({ reads: 0, writes: 0 });
    await sync.GET(getReq("library,history"));
    expect(await totals(usage)).toEqual({ reads: 2, writes: 0 });
  });

  it("saves the counts to data/usage.json after a write, and keeps adding to them", async () => {
    const { sync, usage } = await load();
    await sync.GET(getReq("library"));
    await sync.POST(post({ key: "library", data: { watched: [], watchlist: [], dismissed: [] } }));
    const saved = JSON.parse(await fs.readFile(path.join(tmp, "data", "usage.json"), "utf-8"));
    expect(Object.values(saved)).toEqual([{ reads: 1, writes: 1 }]);
    await sync.POST(post({ key: "library", data: { watched: [], watchlist: [], dismissed: [] } }));
    expect(await totals(usage)).toEqual({ reads: 1, writes: 2 });
  });

  it("saves reads on their own once enough have gathered", async () => {
    const { sync } = await load();
    for (let i = 0; i < 10; i++) await sync.GET(getReq("library"));
    const saved = JSON.parse(await fs.readFile(path.join(tmp, "data", "usage.json"), "utf-8"));
    expect(Object.values(saved)).toEqual([{ reads: 10, writes: 0 }]);
  });

  it("saves the counts after a minute even when there are few", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-30T10:00:00Z"), toFake: ["Date"] });
    const { sync } = await load();
    await sync.GET(getReq("library"));
    vi.setSystemTime(new Date("2026-10-30T10:01:30Z"));
    await sync.GET(getReq("library"));
    const saved = JSON.parse(await fs.readFile(path.join(tmp, "data", "usage.json"), "utf-8"));
    expect(saved).toEqual({ "2026-10-30T10:00": { reads: 2, writes: 0 } });
  });

  it("files counts under the half hour they happened in", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-30T10:29:00Z"), toFake: ["Date"] });
    const { sync, usage } = await load();
    await sync.GET(getReq("library"));
    vi.setSystemTime(new Date("2026-10-30T10:31:00Z"));
    await sync.GET(getReq("library"));
    const { buckets } = await (await usage.GET()).json();
    expect(buckets).toEqual([
      { t: "2026-10-30T10:00", reads: 1, writes: 0 },
      { t: "2026-10-30T10:30", reads: 1, writes: 0 },
    ]);
  });

  it("leaves out counts older than a year", async () => {
    await fs.mkdir(path.join(tmp, "data"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "data", "usage.json"),
      JSON.stringify({ "2020-01-01T00:00": { reads: 5, writes: 5 } })
    );
    const { usage } = await load();
    expect(await totals(usage)).toEqual({ reads: 0, writes: 0 });
  });

  it("keeps the counts to try again when saving fails", async () => {
    const { sync, usage } = await load();
    await sync.GET(getReq("library"));
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation((file, ...rest) =>
      String(file).endsWith("usage.json") ? Promise.reject(new Error("disk full")) : write(file, ...rest)
    );
    await sync.POST(post({ key: "library", data: { watched: [], watchlist: [], dismissed: [] } }));
    expect(console.error).toHaveBeenCalledWith("[Usage] Save failed", expect.any(Error));
    expect(await totals(usage)).toEqual({ reads: 1, writes: 1 });
  });
});

describe("/api/usage with Turso", () => {
  it("saves counts in the usage table and counts that save as a write", async () => {
    const { sync, usage } = await load("libsql://test");
    await sync.GET(getReq("library"));
    await sync.POST(post({ key: "library", data: { watched: [], watchlist: [], dismissed: [] } }));
    const rows = (await db.execute("SELECT reads, writes FROM usage")).rows;
    expect(rows.map((r) => ({ reads: r.reads, writes: r.writes }))).toEqual([{ reads: 1, writes: 1 }]);
    // One more write is waiting to be saved: the save above.
    expect(await totals(usage)).toEqual({ reads: 1, writes: 2 });
  });

  it("answers 500 when the usage table can't be read", async () => {
    const { usage } = await load("libsql://test");
    await usage.GET();
    await db.execute("DROP TABLE usage");
    const res = await usage.GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to read usage" });
  });
});
