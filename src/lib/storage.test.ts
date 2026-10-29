// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { State, clearDiscoveryHistory, empty, exportData, importData, load, mergeStates, reset, save, syncWithServer } from "./storage";
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

describe("save and reset", () => {
  it("writes localStorage and posts to the server", () => {
    const s = state({ shown: ["a"] });
    save(s);
    expect(stored()).toEqual(s);
    expect(fetchMock).toHaveBeenCalledWith("/api/storage", expect.objectContaining({ method: "POST", body: JSON.stringify(s) }));
  });

  it("still saves locally when the server is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    save(state({ shown: ["a"] }));
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(stored().shown).toEqual(["a"]);
  });

  it("reset clears local data and sends an empty state", () => {
    localStorage.setItem(KEY, JSON.stringify(state({ shown: ["a"] })));
    reset();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(empty());
  });
});

describe("clearDiscoveryHistory", () => {
  it("clears shown and displayed but keeps dismissals and lists", () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watched: [mk(1)], shown: ["a"], displayed: ["b"], dismissed: ["c"] })));
    const out = clearDiscoveryHistory();
    expect(out).toEqual(state({ watched: [mk(1)], dismissed: ["c"] }));
    expect(stored()).toEqual(out);
  });
});

describe("syncWithServer", () => {
  it("merges server data with local data", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watched: [mk(1)] })));
    fetchMock.mockResolvedValueOnce(jsonResponse(state({ watched: [mk(2)] }), { headers: { "x-storage-backend": "vercel-blob" } }));
    const out = await syncWithServer();
    expect(out.watched.map((t) => t.id)).toEqual([1, 2]);
    expect(stored().watched).toHaveLength(2);
  });

  it("pushes local data when the server is empty", async () => {
    localStorage.setItem(KEY, JSON.stringify(state({ watchlist: [mk(1)] })));
    fetchMock.mockResolvedValueOnce(jsonResponse(empty(), { headers: { "x-storage-backend": "local-file" } }));
    const out = await syncWithServer();
    expect(out.watchlist).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).watchlist).toHaveLength(1);
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
