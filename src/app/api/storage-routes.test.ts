import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { jsonResponse } from "@/test/fixtures";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), list: vi.fn() }));
import { list, put } from "@vercel/blob";

const putMock = vi.mocked(put);
const listMock = vi.mocked(list);

// Both routes resolve data/ from process.cwd() and read BLOB_READ_WRITE_TOKEN at import time,
// so each test points cwd at a temp dir and re-imports. The real data/storage.json is never touched.
let tmp: string;
async function load(blobToken?: string) {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", blobToken ?? "");
  vi.resetModules();
  return {
    storage: await import("./storage/route"),
    todos: await import("./todos/route"),
  };
}
const readTmp = async (file: string) => JSON.parse(await fs.readFile(path.join(tmp, "data", file), "utf-8"));
const post = (url: string, body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });

const EMPTY_STATE = { watched: [], displayed: [], shown: [], watchlist: [], dismissed: [] };
const state = { ...EMPTY_STATE, shown: ["movie:1"] };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "reel-radar-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(tmp);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  putMock.mockReset();
  listMock.mockReset();
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("/api/storage with local files", () => {
  it("creates an empty state file on first read", async () => {
    const { storage } = await load();
    const res = await storage.GET();
    expect(res.headers.get("x-storage-backend")).toBe("local-file");
    expect(await res.json()).toEqual(EMPTY_STATE);
    expect(await readTmp("storage.json")).toEqual(EMPTY_STATE);
  });

  it("saves and reads back the state", async () => {
    const { storage } = await load();
    const res = await storage.POST(post("http://localhost/api/storage", state));
    expect(await res.json()).toEqual({ success: true });
    expect(await (await storage.GET()).json()).toEqual(state);
  });
});

describe("/api/storage with Vercel Blob", () => {
  it("returns an empty state when no blob exists yet", async () => {
    listMock.mockResolvedValue({ blobs: [] } as never);
    const { storage } = await load("token");
    const res = await storage.GET();
    expect(res.headers.get("x-storage-backend")).toBe("vercel-blob");
    expect(await res.json()).toEqual(EMPTY_STATE);
  });

  it("reads the blob with the token as a bearer header", async () => {
    listMock.mockResolvedValue({ blobs: [{ pathname: "storage.json", url: "https://blob.test/storage.json" }] } as never);
    const fetchMock = vi.fn(async () => jsonResponse(state));
    vi.stubGlobal("fetch", fetchMock);
    const { storage } = await load("token");
    expect(await (await storage.GET()).json()).toEqual(state);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/blob\.test\/storage\.json\?t=\d+$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("falls back to the local file when the blob read fails", async () => {
    listMock.mockRejectedValue(new Error("network"));
    const { storage } = await load("token");
    const res = await storage.GET();
    expect(res.headers.get("x-storage-backend")).toBe("local-file-fallback");
    expect(await res.json()).toEqual(EMPTY_STATE);
  });

  it("writes privately, retrying as public on a public store", async () => {
    putMock.mockRejectedValueOnce(new Error("Cannot use private access on a public store")).mockResolvedValueOnce({} as never);
    const { storage } = await load("token");
    const res = await storage.POST(post("http://localhost/api/storage", state));
    expect(res.headers.get("x-storage-backend")).toBe("vercel-blob");
    expect(putMock.mock.calls.map((c) => (c[2] as { access: string }).access)).toEqual(["private", "public"]);
    expect(putMock.mock.calls[0][0]).toBe("storage.json");
    expect(JSON.parse(putMock.mock.calls[1][1] as string)).toEqual(state);
  });

  it("saves to the local file when the blob write fails", async () => {
    putMock.mockRejectedValue(new Error("quota"));
    const { storage } = await load("token");
    const res = await storage.POST(post("http://localhost/api/storage", state));
    expect(res.headers.get("x-storage-backend")).toBe("local-file-fallback");
    expect(await res.json()).toEqual({ success: true, fallback: true });
    expect(await readTmp("storage.json")).toEqual(state);
    expect(putMock).toHaveBeenCalledTimes(1); // other errors aren't retried as public
  });
});

describe("/api/todos", () => {
  const todos = [{ id: "a", text: "Task", completed: false, createdAt: "2026-03-01T00:00:00.000Z" }];

  it("rejects invalid dates and non-array todos", async () => {
    const { todos: route } = await load();
    expect((await route.GET(new Request("http://localhost/api/todos"))).status).toBe(400);
    expect((await route.GET(new Request("http://localhost/api/todos?date=../../etc"))).status).toBe(400);
    expect((await route.POST(post("http://localhost/api/todos", { date: "2026-3-1", todos }))).status).toBe(400);
    expect((await route.POST(post("http://localhost/api/todos", { date: "2026-03-01", todos: "x" }))).status).toBe(400);
  });

  it("stores one local file per day plus the daily list", async () => {
    const { todos: route } = await load();
    await route.POST(post("http://localhost/api/todos", { date: "2026-03-01", todos }));
    await route.POST(post("http://localhost/api/todos", { date: "daily", todos: [{ id: "d" }] }));
    expect(await readTmp("reel-radar-todos-2026-03-01.json")).toEqual(todos);
    expect(await readTmp("reel-radar-todos-daily.json")).toEqual([{ id: "d" }]);

    const res = await route.GET(new Request("http://localhost/api/todos?date=2026-03-01"));
    expect(res.headers.get("x-storage-backend")).toBe("local-file");
    expect(await res.json()).toEqual({ date: "2026-03-01", todos });
    expect(await (await route.GET(new Request("http://localhost/api/todos?date=2026-03-02"))).json()).toEqual({
      date: "2026-03-02",
      todos: [],
    });
  });

  it("reads and writes per-day blobs", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: "todos/reel-radar-todos-2026-03-01.json", url: "https://blob.test/t.json" }],
    } as never);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(todos)));
    putMock.mockResolvedValue({} as never);
    const { todos: route } = await load("token");

    const res = await route.GET(new Request("http://localhost/api/todos?date=2026-03-01"));
    expect(await res.json()).toEqual({ date: "2026-03-01", todos });
    expect(listMock).toHaveBeenCalledWith({ prefix: "todos/reel-radar-todos-2026-03-01.json" });

    await route.POST(post("http://localhost/api/todos", { date: "2026-03-01", todos }));
    expect(putMock.mock.calls[0][0]).toBe("todos/reel-radar-todos-2026-03-01.json");
  });

  it("returns an empty day when the blob doesn't exist", async () => {
    listMock.mockResolvedValue({ blobs: [] } as never);
    const { todos: route } = await load("token");
    const res = await route.GET(new Request("http://localhost/api/todos?date=2026-03-05"));
    expect(await res.json()).toEqual({ date: "2026-03-05", todos: [] });
  });

  it("falls back to local files when blob calls fail", async () => {
    putMock.mockRejectedValue(new Error("Cannot use private access on a public store"));
    listMock.mockResolvedValue({ blobs: [{ pathname: "todos/reel-radar-todos-2026-03-01.json", url: "https://blob.test/t.json" }] } as never);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { status: 403 })));
    const { todos: route } = await load("token");

    const saved = await route.POST(post("http://localhost/api/todos", { date: "2026-03-01", todos }));
    expect(saved.headers.get("x-storage-backend")).toBe("local-file-fallback");
    expect(putMock).toHaveBeenCalledTimes(2); // private, then public, then give up

    const read = await route.GET(new Request("http://localhost/api/todos?date=2026-03-01"));
    expect(read.headers.get("x-storage-backend")).toBe("local-file-fallback");
    expect(await read.json()).toEqual({ date: "2026-03-01", todos });
  });
});
