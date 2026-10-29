// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { State, clearDiscoveryHistory, empty, exportData, importData, load, mergeStates, reset, save, syncWithServer } from "./storage";
import { RESYNC_AFTER, flush } from "./sync";
import { historyOf, libraryOf } from "./syncDocs";
import { jsonResponse, mk } from "@/test/fixtures";

const KEY = "reel-radar-v1";
const state = (s: Partial<State>): State => ({ ...empty(), ...s });
const stored = (): State => JSON.parse(localStorage.getItem(KEY)!);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("mergeStates", () => {
  it("unions lists and merges watched seasons", () => {
    const base = state({
      watched: [mk(1, { mediaType: "tv", watchedSeasons: [2, 1] })],
      watchlist: [mk(5)],
      dismissed: ["movie:7"],
      shown: ["a"],
      displayed: ["x"],
    });
    const merged = mergeStates(base, {
      watched: [mk(1, { mediaType: "tv", watchedSeasons: [3, 1], rating: 9 }), mk(2)],
      watchlist: [mk(5, { title: "Updated" }), mk(6)],
      dismissed: ["movie:7", "movie:8"],
      shown: ["b"],
    });
    expect(merged.watched).toHaveLength(2);
    expect(merged.watched[0]).toMatchObject({ watchedSeasons: [1, 2, 3], rating: 9 });
    expect(merged.watchlist.map((t) => t.title)).toEqual(["Updated", "Title 6"]);
    expect(merged.dismissed).toEqual(["movie:7", "movie:8"]);
    expect(merged.shown).toEqual(["a", "b"]);
    expect(merged.displayed).toEqual(["x"]);
  });

  it("is idempotent", () => {
    const s = state({ watched: [mk(1, { watchedSeasons: [1] })], shown: ["a"] });
    expect(mergeStates(mergeStates(s, s), s)).toEqual(mergeStates(s, s));
  });

  it("keeps movie and tv with the same id apart", () => {
    expect(mergeStates(empty(), { watched: [mk(1), mk(1, { mediaType: "tv" })] }).watched).toHaveLength(2);
  });
});

describe("load", () => {
  it("returns an empty state when nothing or garbage is stored", () => {
    expect(load()).toEqual(empty());
    localStorage.setItem(KEY, "{not json");
    expect(load()).toEqual(empty());
  });

  it("fills fields missing from older saved data", () => {
    localStorage.setItem(KEY, JSON.stringify({ watched: [mk(1)] }));
    expect(load()).toEqual(state({ watched: [mk(1)] }));
  });
});

// Move the clock past the resync throttle.
const later = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + RESYNC_AFTER);
};
const docsResponse = (docs: Record<string, unknown>) => jsonResponse({ docs });
const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));

describe("save and reset", () => {
  it("writes localStorage at once and pushes the library a few seconds later", () => {
    vi.useFakeTimers();
    const s = state({ watched: [mk(1)] });
    save(s);
    expect(stored()).toEqual(s);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(posts()).toEqual([{ key: "library", data: { watched: [mk(1)], watchlist: [], dismissed: [] } }]);
  });

  it("batches rapid saves into one push", () => {
    vi.useFakeTimers();
    for (let i = 1; i <= 5; i++) save(state({ watched: [mk(1), mk(i + 1)].slice(0, 2), dismissed: [`movie:${i}`] }));
    vi.advanceTimersByTime(5000);
    expect(posts()).toHaveLength(1);
  });

  it("holds history changes until the next push or until the tab is hidden", async () => {
    vi.useFakeTimers();
    save(state({ displayed: ["movie:1"] }));
    vi.advanceTimersByTime(60000);
    expect(fetchMock).not.toHaveBeenCalled();
    save(state({ displayed: ["movie:1"], watched: [mk(2)] }));
    vi.advanceTimersByTime(5000);
    expect(posts().map((p) => p.key).sort()).toEqual(["history", "library"]);
  });

  it("pushes pending changes when the tab is hidden", () => {
    save(state({ shown: ["a"] }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(posts()).toEqual([{ key: "history", data: { displayed: [], shown: ["a"] } }]);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("drops fields that are fetched fresh anyway, and keeps the full cast", () => {
    const cast = Array.from({ length: 8 }, (_, i) => ({ id: i, name: `Actor ${i}` }));
    save(state({ watched: [mk(1, { cast, keywords: ["heist"], trailerYoutubeId: "yt", why: "because" })] }));
    expect(stored().watched[0]).toEqual(mk(1, { cast }));
  });

  it("still saves locally when the server is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    save(state({ watched: [mk(1)] }));
    await flush();
    expect(console.error).toHaveBeenCalled();
    expect(stored().watched).toHaveLength(1);
  });

  it("reset clears local data and pushes empty docs", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ shown: ["a"] })));
    await reset();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(posts().map((p) => p.data)).toEqual([libraryOf(empty()), historyOf(empty())]);
  });
});

describe("clearDiscoveryHistory", () => {
  it("clears shown and displayed but keeps dismissals and lists", () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watched: [mk(1)], shown: ["a"], displayed: ["b"], dismissed: ["c"] })));
    const out = clearDiscoveryHistory();
    expect(out).toEqual(state({ watched: [mk(1)], dismissed: ["c"] }));
    expect(stored()).toEqual(out);
  });

  it("stays cleared after another device that still has the old history syncs", async () => {
    fetchMock.mockResolvedValueOnce(
      docsResponse({ library: null, history: { etag: '"h1"', data: { displayed: ["movie:1"], shown: ["tv:2"] } } })
    );
    await syncWithServer();
    expect(stored().displayed).toEqual(["movie:1"]);
    clearDiscoveryHistory();
    fetchMock.mockClear();
    // The server still holds the history this device cleared, plus one title shown elsewhere since.
    fetchMock
      .mockResolvedValueOnce(
        docsResponse({ library: null, history: { etag: '"h2"', data: { displayed: ["movie:1", "movie:9"], shown: ["tv:2"] } } })
      )
      .mockResolvedValue(jsonResponse({ etag: '"h3"' }));
    later();
    const out = await syncWithServer();
    expect(out.displayed).toEqual(["movie:9"]);
    expect(out.shown).toEqual([]);
    expect(posts().find((p) => p.key === "history")).toMatchObject({ data: { displayed: ["movie:9"], shown: [] }, baseEtag: '"h2"' });
  });
});

describe("syncWithServer", () => {
  it("merges server data with local data and pushes what the server lacks", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watched: [mk(1)] })));
    fetchMock.mockResolvedValueOnce(
      docsResponse({ library: { etag: '"l1"', data: libraryOf(state({ watched: [mk(2)] })) }, history: null })
    );
    const out = await syncWithServer();
    expect(out.watched.map((t) => t.id)).toEqual([1, 2]);
    expect(stored().watched).toHaveLength(2);
    expect(posts()).toEqual([expect.objectContaining({ key: "library", baseEtag: '"l1"' })]);
  });

  it("pushes local data when the server has none", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watchlist: [mk(1)] })));
    fetchMock.mockResolvedValueOnce(docsResponse({ library: null, history: null }));
    const out = await syncWithServer();
    expect(out.watchlist).toHaveLength(1);
    expect(posts()).toEqual([{ key: "library", data: libraryOf(state({ watchlist: [mk(1)] })) }]);
  });

  it("makes no request when synced in the last two minutes, and no write when nothing changed", async () => {
    fetchMock.mockResolvedValueOnce(
      docsResponse({ library: { etag: '"l1"', data: libraryOf(state({ watched: [mk(1)] })) }, history: null })
    );
    await syncWithServer();
    expect(posts()).toEqual([]);
    fetchMock.mockClear();
    await syncWithServer();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("takes a removal made on another device", async () => {
    fetchMock.mockResolvedValueOnce(
      docsResponse({ library: { etag: '"l1"', data: libraryOf(state({ watched: [mk(1), mk(2)] })) }, history: null })
    );
    await syncWithServer();
    fetchMock.mockResolvedValueOnce(
      docsResponse({ library: { etag: '"l2"', data: libraryOf(state({ watched: [mk(1)] })) }, history: null })
    );
    later();
    expect((await syncWithServer()).watched.map((t) => t.id)).toEqual([1]);
  });

  it("keeps local data when the server errors or is unreachable", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watched: [mk(1)] })));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "x" }, { status: 500 }));
    expect((await syncWithServer()).watched).toHaveLength(1);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await syncWithServer()).watched).toHaveLength(1);
  });
});

describe("importData", () => {
  const file = (content: string) => new File([content], "backup.json", { type: "application/json" });

  it("merges a valid backup into the current state", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watched: [mk(1)] })));
    const onSuccess = vi.fn();
    importData(file(JSON.stringify(state({ watched: [mk(2)] }))), onSuccess);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onSuccess.mock.calls[0][0].watched.map((t: { id: number }) => t.id)).toEqual([1, 2]);
    expect(stored().watched).toHaveLength(2);
  });

  it("imports an old-format backup and syncs it in the new layout", async () => {
    vi.useFakeTimers();
    const old = { ...state({ watched: [mk(1, { keywords: ["x"] })], displayed: ["movie:5"] }) };
    const onSuccess = vi.fn();
    importData(file(JSON.stringify(old)), onSuccess);
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(stored().watched).toEqual([mk(1)]);
    vi.advanceTimersByTime(5000);
    expect(posts().map((p) => p.key).sort()).toEqual(["history", "library"]);
  });

  it("reports invalid files", async () => {
    const onError = vi.fn();
    importData(file("not json"), vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Invalid JSON backup file."));
    importData(file("null"), vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });
});

describe("exportData", () => {
  it("downloads the state as a dated JSON file", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toMatch(/^reel-radar-backup-\d{4}-\d{2}-\d{2}\.json$/);
      expect(this.href).toBe("blob:x");
    });
    exportData();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
});
