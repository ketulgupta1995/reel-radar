import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./books/librivox/route";

afterEach(() => vi.unstubAllGlobals());

const call = (query: string) => GET(new Request(`http://localhost/api/books/librivox?${query}`));
const book = (id: number, title: string, last: string, urls: string[] = ["https://www.archive.org/download/x/a.mp3"]) => ({
  id: String(id),
  title,
  language: "English",
  totaltime: "13:06:44",
  totaltimesecs: 47204,
  authors: [{ first_name: "Jane", last_name: last }],
  sections: urls.map((u, i) => ({ title: `Chapter ${i + 1}`, listen_url: u, playtime: "600", readers: [{ display_name: "Chris" }, { display_name: "Chris" }, { display_name: "Ann" }] })),
});
const upstream = (body: unknown, status = 200) => {
  const fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

describe("GET /api/books/librivox", () => {
  it("searches by title, sending a short list without the audio addresses", async () => {
    const fetch = upstream({ books: [book(253, "Pride and Prejudice", "Austen", ["https://www.archive.org/download/a/1.mp3", "https://www.archive.org/download/a/2.mp3"])] });
    const res = await call("title=Pride%20and%20Prejudice&author=Jane%20Austen");
    const { recordings } = await res.json();
    expect(recordings).toEqual([
      { id: "253", title: "Pride and Prejudice", authors: ["Jane Austen"], language: "English", duration: "13:06:44", seconds: 47204, readers: ["Chris", "Ann"], sectionCount: 2 },
    ]);
    expect(res.headers.get("cache-control")).toContain("private");
    const asked = String((fetch.mock.calls[0] as unknown[])[0]);
    expect(asked).toContain("title=%5EPride%20and%20Prejudice");
    expect(asked.startsWith("https://librivox.org/api/feed/audiobooks/")).toBe(true);
  });

  it("puts recordings by the book's author first", async () => {
    upstream({ books: [book(1, "Pride and Prejudice", "Someone"), book(2, "Pride and Prejudice", "Austen")] });
    const { recordings } = await (await call("title=Pride&author=Jane%20Austen")).json();
    expect(recordings.map((r: { id: string }) => r.id)).toEqual(["2", "1"]);
  });

  it("sends the sections of one recording, keeping only archive.org audio over https", async () => {
    upstream({
      books: [
        book(253, "Emma", "Austen", ["https://www.archive.org/download/a/1.mp3", "https://evil.example/2.mp3", "http://archive.org/3.mp3", "https://ia800.us.archive.org/4.mp3", "not a url"]),
      ],
    });
    const { recordings } = await (await call("id=253")).json();
    expect(recordings[0].sections).toEqual([
      { title: "Chapter 1", url: "https://www.archive.org/download/a/1.mp3", seconds: 600 },
      { title: "Chapter 4", url: "https://ia800.us.archive.org/4.mp3", seconds: 600 },
    ]);
    expect(recordings[0].sectionCount).toBe(2);
  });

  it("leaves out recordings with no usable audio, and says none when nothing matches", async () => {
    upstream({ books: [book(1, "Emma", "Austen", ["https://evil.example/x.mp3"])] });
    expect((await (await call("title=Emma")).json()).recordings).toEqual([]);
    upstream({ error: "Audiobook not found" }, 404);
    const none = await call("title=Zzz");
    expect(none.status).toBe(200);
    expect((await none.json()).recordings).toEqual([]);
  });

  it("refuses a request that isn't a title or a recording number, without contacting LibriVox", async () => {
    const fetch = upstream({ books: [] });
    for (const q of ["", "title=", "title=" + "x".repeat(201), "id=abc", "id=1;2", "id=12345678", "id="]) expect((await call(q)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains when LibriVox can't be reached or sends something odd", async () => {
    upstream({}, 503);
    expect((await call("title=Emma")).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("timeout"))));
    const down = await call("title=Emma");
    expect(down.status).toBe(502);
    expect((await down.json()).error).toMatch(/Couldn't reach LibriVox/);
    upstream({ nothing: true });
    expect((await call("title=Emma")).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error("bad json")) })));
    expect((await call("title=Emma")).status).toBe(502);
  });

  it("copes with missing details in a recording", async () => {
    upstream({ books: [{ id: 9, sections: [{ listen_url: "https://www.archive.org/download/a/1.mp3" }] }] });
    const { recordings } = await (await call("title=X")).json();
    expect(recordings[0]).toMatchObject({ id: "9", title: "", authors: [], readers: [], seconds: 0, sectionCount: 1 });
  });
});
