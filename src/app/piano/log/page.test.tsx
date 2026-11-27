// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { requests, routeFetch } from "@/test/pages";
import PianoLog from "./page";

const at = (d: number, h = 12) => new Date(2026, 10, d, h).getTime();
const seed = (items: Record<string, unknown>, doc = "piano-2026-11") => localStorage.setItem(`reel-radar-${doc}`, JSON.stringify({ items }));
const manual = (id: string, startedAt: number, minutes: number, note: string) => ({ id, kind: "manual", startedAt, durationMs: minutes * 60_000, note, updatedAt: startedAt });
const stored = () => Object.values(JSON.parse(localStorage.getItem("reel-radar-piano-2026-11") || '{"items":{}}').items) as { note: string; durationMs: number; startedAt: number }[];
const open = async () => {
  render(<PianoLog />);
  await act(async () => {});
};
const add = (minutes: string, note: string) => {
  fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: minutes } });
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: note } });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Practice log page", () => {
  it("renders an empty shell first, then zeros", async () => {
    expect(renderToString(<PianoLog />)).not.toContain("min");
    render(<PianoLog />);
    await act(async () => {});
    expect(screen.getByTestId("today-minutes").textContent).toBe("0 min");
    expect(screen.getByTestId("streak").textContent).toBe("0 days");
    expect(screen.getAllByTestId("day-row").length).toBe(14);
    expect(screen.getByText("Nothing logged yet.")).toBeTruthy();
    expect(screen.getByText(/Finish a drill round/)).toBeTruthy();
  });

  it("counts a song run in the minutes and the recent list, but gives it no weekly accuracy table", async () => {
    seed({ s: { id: "s", kind: "drill", drill: "songs", startedAt: at(27, 8), durationMs: 600_000, items: { "ode-to-joy": { attempts: 1, misses: 3, slow: 0, avgMs: 0 } }, updatedAt: at(27, 8) } });
    await open();
    expect(screen.getByTestId("today-minutes").textContent).toBe("10 min");
    expect(screen.getByText("Song")).toBeTruthy();
    expect(screen.queryByRole("table", { name: /trend/ })).toBeNull();
  });

  it("adds, edits and deletes a manual entry, updating today's minutes and the streak", async () => {
    await open();
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    add("8", "Minuet in G");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByTestId("today-minutes").textContent).toBe("8 min");
    expect(screen.getByTestId("streak").textContent).toBe("0 days");
    expect(stored()).toMatchObject([{ note: "Minuet in G", durationMs: 480_000 }]);
    expect((screen.getByLabelText("Minutes") as HTMLInputElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Edit Minuet in G" }));
    expect((screen.getByLabelText("Note") as HTMLInputElement).value).toBe("Minuet in G");
    add("12", "Minuet in G, hands together");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByTestId("today-minutes").textContent).toBe("12 min");
    expect(screen.getByTestId("streak").textContent).toBe("1 day");
    expect(stored().length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Delete Minuet/ }));
    expect(screen.getByTestId("today-minutes").textContent).toBe("0 min");
    expect(screen.getByTestId("streak").textContent).toBe("0 days");
    expect(stored()).toEqual([]);
  });

  it("logs on an earlier day, builds a streak ending yesterday, and can move an entry's day or cancel an edit", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "1" } });
    add("15", "Scales");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByTestId("today-minutes").textContent).toBe("0 min");
    expect(screen.getByTestId("streak").textContent).toBe("1 day");
    expect(stored()[0].startedAt).toBe(at(26));

    fireEvent.click(screen.getByRole("button", { name: "Edit Scales" }));
    expect((screen.getByLabelText("Day") as HTMLSelectElement).value).toBe("1");
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(stored()[0].startedAt).toBe(at(25));
    expect(screen.getByTestId("streak").textContent).toBe("0 days");

    fireEvent.click(screen.getByRole("button", { name: "Edit Scales" }));
    expect(screen.getByText("Edit entry")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Add practice done away/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Scales" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Scales" })); // deleting the entry being edited closes the form
    expect(screen.getByText(/Add practice done away/)).toBeTruthy();
  });

  it("adds drill minutes to manual ones, shows drill entries without buttons, and a weekly trend", async () => {
    seed({
      d: { id: "d", kind: "drill", drill: "notes", startedAt: at(27, 9), durationMs: 120_000, updatedAt: 1, items: { C: { attempts: 10, misses: 2, slow: 0, avgMs: 1250 } } },
      m: manual("m", at(27, 8), 9, ""),
    });
    await open();
    expect(screen.getByTestId("today-minutes").textContent).toBe("11 min");
    expect(screen.getByTestId("streak").textContent).toBe("1 day");
    const rows = screen.getAllByTestId("entry");
    expect(rows.length).toBe(2);
    const drillRow = rows.find((r) => within(r).queryByText("Note drill"))!;
    expect(within(drillRow).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit entry" })).toBeTruthy(); // a manual entry with no note
    const table = screen.getByRole("table", { name: "Note drill trend" });
    expect(within(table).getByText("80%")).toBeTruthy();
    expect(within(table).getByText("1.3 s")).toBeTruthy();
  });

  it("lists a rhythm drill round and its weekly trend in milliseconds", async () => {
    seed({ r: { id: "r", kind: "drill", drill: "rhythm", startedAt: at(27, 9), durationMs: 120_000, updatedAt: 1, items: { quarters: { attempts: 4, misses: 1, slow: 0, avgMs: 42 } } } });
    await open();
    expect(within(screen.getByTestId("entry")).getByText("Rhythm drill")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Rhythm drill trend" });
    expect(within(table).getByText("75%")).toBeTruthy();
    expect(within(table).getByText("42 ms")).toBeTruthy();
    expect(within(table).getByText("Passed")).toBeTruthy();
  });

  it("names an ear-training round in the list and its trend", async () => {
    seed({ e: { id: "e", kind: "drill", drill: "ear", startedAt: at(27, 9), durationMs: 120_000, updatedAt: 1, items: { "note-C": { attempts: 4, misses: 1, slow: 0, avgMs: 900 } } } });
    await open();
    expect(within(screen.getByTestId("entry")).getByText("Ear training")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Ear training trend" })).toBeTruthy();
  });

  it("reads entries from the previous month's doc for the streak", async () => {
    seed({ a: manual("a", new Date(2026, 9, 31, 12).getTime(), 10, "Oct") }, "piano-2026-10");
    seed({ b: manual("b", at(1), 10, "Nov 1"), c: manual("c", at(27), 10, "today") });
    vi.setSystemTime(new Date(2026, 10, 2, 10));
    await open();
    expect(screen.getByTestId("streak").textContent).toBe("2 days");
  });

  describe("sync", () => {
    const pushed = (f: ReturnType<typeof routeFetch>) => requests(f, "/api/sync").filter((r) => r.init?.method === "POST").map((r) => JSON.parse(r.init!.body as string).key as string).sort();
    const pulled = (f: ReturnType<typeof routeFetch>) => requests(f, "/api/sync").filter((r) => !r.init?.method).flatMap((r) => decodeURIComponent(r.url.searchParams.get("keys")!).split(",").map((k) => k.split(":")[0]));
    const settings = (months: string[]) => ({ unlocks: {}, slowSteps: {}, slowAt: {}, months, updatedAt: 1 });

    it("pulls every month the settings list when it opens, and shows what arrives", async () => {
      localStorage.setItem("reel-radar-piano-settings", JSON.stringify(settings(["2026-11"])));
      const old = { items: { o: manual("o", new Date(2026, 5, 3, 12).getTime(), 30, "June scales") } };
      const f = routeFetch({
        "/api/sync": (u: URL, init?: RequestInit) => {
          if (init?.method === "POST") return { etag: '"n"' };
          const docs: Record<string, unknown> = {};
          for (const k of decodeURIComponent(u.searchParams.get("keys")!).split(",").map((x) => x.split(":")[0])) {
            docs[k] = k === "piano-settings" ? { etag: '"s"', data: settings(["2026-06", "2026-11"]) } : k === "piano-2026-06" ? { etag: '"j"', data: old } : null;
          }
          return { docs };
        },
      });
      await open();
      expect(pulled(f)).toEqual(expect.arrayContaining(["piano-settings", "piano-2026-11", "piano-2026-10", "piano-2026-06"]));
      expect(pulled(f).filter((k) => k === "piano-2026-06")).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem("reel-radar-piano-2026-06")!).items.o.note).toBe("June scales");
    });

    it("shows a manual entry another device added when the tab comes back into view", async () => {
      const t = at(26);
      let served: unknown = null;
      routeFetch({ "/api/sync": (_u: URL, init?: RequestInit) => (init?.method === "POST" ? { etag: '"n"' } : { docs: { "piano-2026-11": served && { etag: '"v"', data: served } } }) });
      await open();
      expect(screen.getByText("Nothing logged yet.")).toBeTruthy();
      served = { items: { z: manual("z", t, 12, "from laptop") } };
      vi.setSystemTime(new Date(2026, 10, 27, 10, 5)); // past the re-sync throttle
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
      await act(async () => {});
      expect(screen.getByText("from laptop")).toBeTruthy();
    });

    it("pushes the month and settings after a manual entry, and only the month after the next", async () => {
      const f = routeFetch();
      await open();
      add("8", "one");
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      expect(pushed(f)).toEqual([]);
      await act(async () => void vi.advanceTimersByTime(3500));
      expect(pushed(f)).toEqual(["piano-2026-11", "piano-settings"]);
      add("9", "two");
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      await act(async () => void vi.advanceTimersByTime(3500));
      expect(pushed(f)).toEqual(["piano-2026-11", "piano-2026-11", "piano-settings"]);
    });

    it("pushes a delete", async () => {
      seed({ m: manual("m", at(27, 8), 9, "gone") });
      const f = routeFetch();
      await open();
      fireEvent.click(screen.getByRole("button", { name: /Delete gone/ }));
      await act(async () => void vi.advanceTimersByTime(3500));
      expect(pushed(f)).toEqual(["piano-2026-11"]);
    });
  });
});
