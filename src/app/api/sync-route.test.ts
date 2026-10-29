import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import { mk } from "@/test/fixtures";

vi.mock("@vercel/blob", () => {
  class BlobPreconditionFailedError extends Error {}
  return { get: vi.fn(), put: vi.fn(), BlobPreconditionFailedError };
});
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

const getMock = vi.mocked(get);
const putMock = vi.mocked(put);

// The route resolves data/ from process.cwd() and remembers the store's access mode per module
// instance, so each test points cwd at a temp dir and re-imports. The real data/ is never touched.
let tmp: string;
async function load(blobToken?: string) {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", blobToken ?? "");
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

// What @vercel/blob's get() resolves to.
const blob200 = (data: unknown, etag = '"b1"') =>
  ({ statusCode: 200, stream: new Response(gzipSync(JSON.stringify(data))).body, blob: { etag } }) as never;
const blob304 = (etag = '"b1"') => ({ statusCode: 304, stream: null, blob: { etag } }) as never;

const library = { watched: [mk(1)], watchlist: [], dismissed: [] };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-radar-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.spyOn(console, "error").mockImplementation(() => {});
  getMock.mockReset();
  putMock.mockReset();
});
afterEach(async () => {
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

describe("/api/sync with Vercel Blob", () => {
  it("reads gzipped docs with get(), uncached, and never list()", async () => {
    getMock.mockResolvedValue(blob200(library));
    const route = await load("token");
    const { docs } = await (await route.GET(getReq("library"))).json();
    expect(docs.library).toEqual({ etag: '"b1"', data: library });
    expect(getMock).toHaveBeenCalledWith("v2/library.json.gz", { access: "private", useCache: false, ifNoneMatch: undefined });
  });

  it("sends the client's etag and reports a 304 as unchanged", async () => {
    getMock.mockResolvedValue(blob304('"b1"'));
    const route = await load("token");
    const { docs } = await (await route.GET(getReq('library:"b1",history:"h1"'))).json();
    expect(docs.library).toEqual({ etag: '"b1"', unchanged: true });
    expect(getMock).toHaveBeenCalledWith("v2/history.json.gz", expect.objectContaining({ ifNoneMatch: '"h1"' }));
  });

  it("finds a public store and keeps using it", async () => {
    getMock.mockImplementation(async (_path, opts) => (opts.access === "public" ? blob200(library) : null));
    const route = await load("token");
    await route.GET(getReq("library"));
    getMock.mockClear();
    await route.GET(getReq("library"));
    expect(getMock.mock.calls.map(([, o]) => o.access)).toEqual(["public"]);
  });

  it("treats a failed read as an error, never as a missing doc", async () => {
    getMock.mockImplementation(async (_path, opts) => {
      if (opts.access === "private") throw new Error("network down");
      return null;
    });
    const route = await load("token");
    expect((await route.GET(getReq("library"))).status).toBe(500);
  });

  it("writes gzipped JSON conditionally and answers 409 when the etag is stale", async () => {
    putMock.mockResolvedValueOnce({ etag: '"p1"' } as never);
    const route = await load("token");
    const ok = await route.POST(post({ key: "planner-2026-10", data: { items: [] }, baseEtag: '"p0"' }));
    expect(await ok.json()).toEqual({ etag: '"p1"' });
    const [pathname, body, options] = putMock.mock.calls[0];
    expect(pathname).toBe("v2/planner-2026-10.json.gz");
    expect(JSON.parse(gunzipSync(body as Buffer).toString())).toEqual({ items: [] });
    expect(options).toMatchObject({ access: "private", allowOverwrite: true, addRandomSuffix: false, ifMatch: '"p0"' });

    putMock.mockRejectedValueOnce(new BlobPreconditionFailedError());
    getMock.mockResolvedValueOnce(blob200({ items: [{ x: 1 }] }, '"p2"'));
    const stale = await route.POST(post({ key: "planner-2026-10", data: { items: [] }, baseEtag: '"p0"' }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ etag: '"p2"', data: { items: [{ x: 1 }] } });
  });

  it("retries a write as public on a public store", async () => {
    putMock
      .mockRejectedValueOnce(new Error("Cannot use private access on a public store"))
      .mockResolvedValueOnce({ etag: '"p1"' } as never);
    const route = await load("token");
    expect((await route.POST(post({ key: "library", data: library }))).status).toBe(200);
    expect(putMock.mock.calls.map(([, , o]) => o.access)).toEqual(["private", "public"]);
  });

  it("returns 500 when a write fails for another reason", async () => {
    putMock.mockRejectedValueOnce(new Error("boom"));
    const route = await load("token");
    expect((await route.POST(post({ key: "library", data: library }))).status).toBe(500);
  });
});
