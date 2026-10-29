// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocAdapter, SYNC_EVENT, flush, markDirty, registerDocs, syncKeys, watchKeys } from "./sync";
import { merge3 } from "./syncDocs";
import { jsonResponse } from "@/test/fixtures";

// A tiny doc type for exercising the engine on its own: a list of strings in localStorage.
type Doc = { items: string[] };
const LOCAL = "test-doc";
const read = (): Doc => JSON.parse(localStorage.getItem(LOCAL) || '{"items":[]}');
const write = (doc: Doc) => localStorage.setItem(LOCAL, JSON.stringify(doc));
const adapter: DocAdapter<Doc> = {
  read,
  write,
  merge: (l, s, b) => ({ items: merge3(l.items, s.items, b?.items, (x) => x, (x) => x) }),
  empty: () => ({ items: [] }),
  flushDelay: 1000,
};
registerDocs((key) => (key === "library" ? adapter : undefined));

const edit = (items: string[]) => {
  write({ items });
  markDirty("library");
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ etag: '"e"' }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("sync engine", () => {
  it("re-syncs watched docs when the tab comes back into view, and tells the page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockResolvedValueOnce(jsonResponse({ docs: { library: { etag: '"e1"', data: { items: ["a"] } } } }));
    await syncKeys(["library"]);
    const stop = watchKeys(["library"]);
    const onSync = vi.fn();
    window.addEventListener(SYNC_EVENT, onSync);

    setVisibility("visible"); // too soon after the last sync: no request
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    fetchMock.mockResolvedValueOnce(jsonResponse({ docs: { library: { etag: '"e2"', data: { items: ["a", "b"] } } } }));
    setVisibility("visible");
    await vi.waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));
    expect(read().items).toEqual(["a", "b"]);

    stop();
    window.removeEventListener(SYNC_EVENT, onSync);
  });

  it("keeps a doc dirty when it changes while its push is out", async () => {
    let finish: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (finish = r)));
    edit(["a"]);
    const pushing = flush(["library"]);
    edit(["a", "b"]); // lands mid-request
    finish(jsonResponse({ etag: '"e1"' }));
    await pushing;
    expect(JSON.parse(localStorage.getItem("reel-radar-sync:library")!).dirty).toBe(true);
    await flush(["library"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ data: { items: ["a", "b"] }, baseEtag: '"e1"' });
  });

  it("pushes again as a new doc when the server copy has disappeared", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ docs: { library: { etag: '"e1"', data: { items: ["a"] } } } }));
    await syncKeys(["library"], { force: true });
    edit(["a", "b"]);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ etag: null, data: null }, { status: 409 }))
      .mockResolvedValueOnce(jsonResponse({ etag: '"e2"' }));
    await flush(["library"]);
    const retry = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(retry).toEqual({ key: "library", data: { items: ["a", "b"] } }); // no baseEtag
    expect(read().items).toEqual(["a", "b"]);
  });

  it("leaves a failed push dirty for the next try", async () => {
    edit(["a"]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "x" }, { status: 500 }));
    await flush(["library"]);
    expect(JSON.parse(localStorage.getItem("reel-radar-sync:library")!).dirty).toBe(true);
  });
});
