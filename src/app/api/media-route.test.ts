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
  return { media: await import("./media/[id]/route"), usage: await import("./usage/route"), sync: await import("./sync/route") };
}

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const url = (id = ID) => `http://localhost/api/media/${id}`;
const put = (body: BodyInit | null, type = "image/jpeg", headers: Record<string, string> = {}) =>
  new Request(url(), { method: "PUT", body, headers: { "Content-Type": type, ...headers } });
const bytes = new Uint8Array([1, 2, 3, 250]);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-radar-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = createClient({ url: ":memory:" });
});
afterEach(async () => {
  db.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe.each([
  ["local files", undefined],
  ["Turso", "libsql://test"],
])("/api/media with %s", (_name, tursoUrl) => {
  it("stores a file, serves it back cached for good, and deletes it", async () => {
    const { media, usage } = await load(tursoUrl);
    const saved = await media.PUT(put(bytes, "audio/webm;codecs=opus"), ctx());
    expect(saved.status).toBe(200);

    const res = await media.GET(new Request(url()), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/webm");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    expect((await media.DELETE(new Request(url(), { method: "DELETE" }), ctx())).status).toBe(200);
    expect((await media.GET(new Request(url()), ctx())).status).toBe(404);
    expect((await media.DELETE(new Request(url(), { method: "DELETE" }), ctx())).status).toBe(200); // already gone

    const { buckets } = await (await usage.GET()).json();
    const total = (k: "reads" | "writes") => buckets.reduce((n: number, b: Record<string, number>) => n + b[k], 0);
    expect(total("reads")).toBe(2);
    expect(total("writes")).toBeGreaterThanOrEqual(3);
  });

  it("isn't reachable through /api/sync", async () => {
    const { media, sync } = await load(tursoUrl);
    await media.PUT(put(bytes), ctx());
    const res = await sync.GET(new Request(`http://localhost/api/sync?keys=media-${ID}`));
    expect(res.status).toBe(400);
  });
});

describe("/api/media validation", () => {
  it("rejects bad ids, types, sizes and empty bodies", async () => {
    const { media } = await load();
    expect((await media.GET(new Request(url("../x")), ctx("../x"))).status).toBe(400);
    expect((await media.PUT(put(bytes), ctx("BAD.png"))).status).toBe(400);
    expect((await media.DELETE(new Request(url("x")), ctx("x"))).status).toBe(400);
    expect((await media.PUT(put(bytes, "text/html"), ctx())).status).toBe(415);
    expect((await media.PUT(put(bytes, "image/svg+xml"), ctx())).status).toBe(415);
    expect((await media.PUT(put(bytes, "image/jpeg", { "Content-Length": "99999999" }), ctx())).status).toBe(413);
    expect((await media.PUT(put(new Uint8Array(1_500_001)), ctx())).status).toBe(413);
    expect((await media.PUT(put(null), ctx())).status).toBe(400);
    expect((await media.GET(new Request(url()), ctx())).status).toBe(404);
  });

  it("won't serve a stored doc with a type it doesn't allow", async () => {
    const { media } = await load();
    await fs.mkdir(path.join(tmp, "data"), { recursive: true });
    await fs.writeFile(path.join(tmp, "data", `media-${ID}.json`), JSON.stringify({ mime: "text/html", data: "PHNjcmlwdD4=" }));
    expect((await media.GET(new Request(url()), ctx())).status).toBe(404);
  });

  it("answers 500 when storage fails", async () => {
    const { media } = await load("libsql://test");
    db.close(); // every query now throws
    expect((await media.PUT(put(bytes), ctx())).status).toBe(500);
    expect((await media.GET(new Request(url()), ctx())).status).toBe(500);
    expect((await media.DELETE(new Request(url(), { method: "DELETE" }), ctx())).status).toBe(500);
    db = createClient({ url: ":memory:" }); // for afterEach
  });
});
