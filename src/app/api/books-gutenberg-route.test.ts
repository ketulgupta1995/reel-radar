import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./books/gutenberg/[id]/route";

afterEach(() => vi.unstubAllGlobals());

const call = (id: string) => GET(new Request(`http://localhost/api/books/gutenberg/${id}`), { params: Promise.resolve({ id }) });
const upstream = (init: { status?: number; length?: number; body?: Uint8Array }) => {
  const body = init.body ?? new Uint8Array(4);
  const fetch = vi.fn(async () => ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(init.length === undefined ? {} : { "content-length": String(init.length) }),
    arrayBuffer: async () => body.buffer,
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("GET /api/books/gutenberg/[id]", () => {
  it("sends the no-illustrations EPUB of a book, from Gutenberg only", async () => {
    const fetch = upstream({ body: new Uint8Array([5, 6, 7]) });
    const res = await call("1342");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([5, 6, 7]));
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe("https://www.gutenberg.org/cache/epub/1342/pg1342.epub");
  });

  it("refuses anything that isn't a book number, without contacting Gutenberg", async () => {
    const fetch = upstream({});
    for (const id of ["abc", "12/../../x", "1342.epub", "12345678", ""]) expect((await call(id)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains a book with no EPUB and a Gutenberg that can't be reached", async () => {
    upstream({ status: 404 });
    const missing = await call("26301");
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/no EPUB/);

    upstream({ status: 503 });
    expect((await call("1")).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("timeout"))));
    const down = await call("1");
    expect(down.status).toBe(502);
    expect((await down.json()).error).toMatch(/Couldn't reach/);
  });

  it("refuses a book over Vercel's 4.5 MB response limit, whether or not Gutenberg says how big it is", async () => {
    upstream({ length: 24_864_457 });
    const big = await call("1342");
    expect(big.status).toBe(413);
    expect((await big.json()).error).toMatch(/too big/);

    upstream({ body: new Uint8Array(4_400_001) });
    expect((await call("1342")).status).toBe(413);
  });

  it("reports a download that breaks off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => Promise.reject(new Error("reset")) })));
    expect((await call("1")).status).toBe(502);
  });
});
