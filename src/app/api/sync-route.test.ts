import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { createClient, type Client } from "@libsql/client";
import { mk } from "@/test/fixtures";

// The route talks to Turso through the web client; tests swap in a real in-memory libSQL database.
let db: Client;
vi.mock("@libsql/client/web", () => ({ createClient: () => db }));

// The route resolves data/ from process.cwd() and keeps its database connection per module
// instance, so each test points cwd at a temp dir and re-imports. The real data/ is never touched.
let tmp: string;
async function load(tursoUrl?: string) {
  vi.stubEnv("TURSO_DATABASE_URL", tursoUrl ?? "");
  vi.resetModules();
  return import("./sync/route");
}
const readTmp = async (file: string) => JSON.parse(await fs.readFile(path.join(tmp, "data", file), "utf-8"));
const writeTmp = async (file: string, data: unknown) => {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true });
  await fs.writeFile(path.join(tmp, "data", file), JSON.stringify(data), "utf-8");
};
const getReq = (keys: string) => new Request(`http://localhost/api/sync?keys=${encodeURIComponent(keys)}`);
const post = (body: unknown) => new Request("http://localhost/api/sync", { method: "POST", body: JSON.stringify(body) });

const library = { watched: [mk(1)], watchlist: [], dismissed: [] };

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

describe("/api/sync with local files", () => {
  it("returns null for docs that don't exist yet, and rejects unknown keys", async () => {
    const route = await load();
    expect(await (await route.GET(getReq("planner-2026-10,planner-daily"))).json()).toEqual({
      docs: { "planner-2026-10": null, "planner-daily": null },
    });
    for (const keys of ["", "../secrets", "planner-26-1", "library,todos"]) {
      expect((await route.GET(getReq(keys))).status).toBe(400);
    }
  });

  it("writes a doc and reads it back; with its etag, an unchanged doc comes back without data", async () => {
    const route = await load();
    const { etag } = await (await route.POST(post({ key: "library", data: library }))).json();
    expect(await readTmp("library.json")).toEqual(library);
    expect((await (await route.GET(getReq("library"))).json()).docs.library).toEqual({ etag, data: library });
    expect((await (await route.GET(getReq(`library:${etag}`))).json()).docs.library).toEqual({ etag, unchanged: true });
  });

  it("refuses a write against a stale etag and returns the current copy", async () => {
    const route = await load();
    const first = await (await route.POST(post({ key: "history", data: { displayed: ["a"], shown: [] } }))).json();
    const second = await (
      await route.POST(post({ key: "history", data: { displayed: ["b"], shown: [] }, baseEtag: first.etag }))
    ).json();
    const stale = await route.POST(post({ key: "history", data: { displayed: ["c"], shown: [] }, baseEtag: first.etag }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ etag: second.etag, data: { displayed: ["b"], shown: [] } });
  });

  it("rejects invalid writes", async () => {
    const route = await load();
    expect((await route.POST(post({ key: "nope", data: {} }))).status).toBe(400);
    expect((await route.POST(post({ key: "library" }))).status).toBe(400);
    expect((await route.POST(new Request("http://localhost/api/sync", { method: "POST", body: "{bad" }))).status).toBe(400);
  });

  it("splits the old storage.json into library and history, once", async () => {
    await writeTmp("storage.json", {
      watched: [mk(1, { keywords: ["heist"], trailerYoutubeId: "yt" })],
      watchlist: [mk(2)],
      dismissed: ["movie:3"],
      displayed: ["movie:4"],
      shown: ["tv:5"],
    });
    const route = await load();
    const { docs } = await (await route.GET(getReq("library,history"))).json();
    expect(docs.library.data).toEqual({ watched: [mk(1)], watchlist: [mk(2)], dismissed: ["movie:3"] });
    expect(docs.history.data).toEqual({ displayed: ["movie:4"], shown: ["tv:5"] });
    expect(await readTmp("history.json")).toEqual(docs.history.data);
    // Later reads use the new docs; storage.json is left as it was.
    await writeTmp("storage.json", { watched: [mk(9)] });
    const again = await (await route.GET(getReq("library"))).json();
    expect(again.docs.library.data.watched).toEqual([mk(1)]);
  });
});

describe("/api/sync with Turso", () => {
  const stored = async (key: string) => (await db.execute({ sql: "SELECT * FROM docs WHERE key = ?", args: [key] })).rows[0];

  it("creates the table, then writes a doc and reads it back", async () => {
    const route = await load("libsql://test");
    expect(await (await route.GET(getReq("library"))).json()).toEqual({ docs: { library: null } });
    const { etag } = await (await route.POST(post({ key: "library", data: library }))).json();
    expect(JSON.parse(String((await stored("library")).data))).toEqual(library);
    expect((await (await route.GET(getReq("library"))).json()).docs.library).toEqual({ etag, data: library });
  });

  it("answers an unchanged etag without the body, and sends the body for a different one", async () => {
    const route = await load("libsql://test");
    const { etag } = await (await route.POST(post({ key: "history", data: { displayed: [], shown: [] } }))).json();
    const { docs } = await (await route.GET(getReq(`history:${etag},library:"x"`))).json();
    expect(docs.history).toEqual({ etag, unchanged: true });
    expect(docs.library).toBeNull();
    const stale = await (await route.GET(getReq('history:"old"'))).json();
    expect(stale.docs.history).toEqual({ etag, data: { displayed: [], shown: [] } });
  });

  it("writes conditionally and answers 409 with the current copy when the etag is stale", async () => {
    const route = await load("libsql://test");
    const first = await (await route.POST(post({ key: "planner-2026-10", data: { items: [] } }))).json();
    const second = await (
      await route.POST(post({ key: "planner-2026-10", data: { items: [{ x: 1 }] }, baseEtag: first.etag }))
    ).json();
    const stale = await route.POST(post({ key: "planner-2026-10", data: { items: [] }, baseEtag: first.etag }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ etag: second.etag, data: { items: [{ x: 1 }] } });
    expect(JSON.parse(String((await stored("planner-2026-10")).data))).toEqual({ items: [{ x: 1 }] });
  });

  it("answers 409 with nulls when a conditional write finds no doc", async () => {
    const route = await load("libsql://test");
    const res = await route.POST(post({ key: "library", data: library, baseEtag: '"gone"' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ etag: null, data: null });
  });

  it("treats a failed read as an error, never as a missing doc", async () => {
    const route = await load("libsql://test");
    vi.spyOn(db, "execute").mockRejectedValue(new Error("network down"));
    expect((await route.GET(getReq("library"))).status).toBe(500);
  });

  it("returns 500 when a write fails for another reason", async () => {
    const route = await load("libsql://test");
    await route.GET(getReq("library"));
    vi.spyOn(db, "execute").mockRejectedValue(new Error("boom"));
    expect((await route.POST(post({ key: "library", data: library }))).status).toBe(500);
  });

  it("does not migrate storage.json, which the migration script handles", async () => {
    await writeTmp("storage.json", { watched: [mk(1)] });
    const route = await load("libsql://test");
    expect((await (await route.GET(getReq("library"))).json()).docs.library).toBeNull();
  });
});
