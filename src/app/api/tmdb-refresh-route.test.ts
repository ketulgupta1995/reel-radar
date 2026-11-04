import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock("next/cache", () => cache);

import { POST } from "./tmdb/refresh/route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/tmdb/refresh", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const expired = () => cache.revalidateTag.mock.calls.map(([tag]) => tag);

beforeEach(() => {
  cache.revalidateTag.mockReset();
});

describe("POST /api/tmdb/refresh", () => {
  it("expires only the lists by default, at once, and isn't cached", async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(cache.revalidateTag.mock.calls).toEqual([["tmdb-lists", { expire: 0 }]]);
  });

  it("also expires the person or title it's given", async () => {
    await post({ person: 42 });
    expect(expired()).toEqual(["tmdb-lists", "tmdb-person-42"]);
    cache.revalidateTag.mockReset();
    await post({ title: { type: "tv", id: 7 } });
    expect(expired()).toEqual(["tmdb-lists", "tmdb-tv-7"]);
  });

  it("treats an unreadable body as no scope", async () => {
    expect((await post("not json")).status).toBe(200);
    expect(expired()).toEqual(["tmdb-lists"]);
  });

  it("rejects bad ids and types without expiring anything", async () => {
    for (const body of [{ person: "42" }, { person: -1 }, { person: 1.5 }, { title: { type: "person", id: 1 } }, { title: { type: "movie", id: 0 } }, { title: "x" }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });
});
