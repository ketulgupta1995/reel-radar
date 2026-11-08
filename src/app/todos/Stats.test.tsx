// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { jsonResponse } from "@/test/fixtures";
import { routeFetch, requests } from "@/test/pages";
import { Todo, getTodayDate, saveTodos, shiftDate, updateDayLog } from "@/lib/todos";
import { formatShortDate } from "./planner";

import { removeLogItem } from "@/lib/plannerSettings";
import { setLogCount, setLogTick } from "@/lib/todos";
import { Stats } from "./Stats";

const onOpenReview = vi.fn();
const onOpenToday = vi.fn();
const PlannerStatsPage = () => <Stats onOpenReview={onOpenReview} onOpenToday={onOpenToday} />;

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("Stats", () => {
  it("says when there's nothing to show", () => {
    routeFetch();
    render(<PlannerStatsPage />);
    expect(screen.getByText(/No tasks in this period yet/)).toBeTruthy();
    fireEvent.click(screen.getByText("Plan your day"));
    expect(onOpenToday).toHaveBeenCalled();
  });

  it("summarises the days in range and switches ranges", async () => {
    const fetch = routeFetch();
    const today = getTodayDate();
    saveTodos(
      [
        todo("Ship", { completed: true, start: 540, duration: 90, tag: "work", spent: 45 }),
        todo("Gym", { start: 1080, duration: 60, tag: "health" }),
        todo("Errand"),
      ],
      today
    );
    saveTodos([todo("Old", { completed: true, carriedFrom: shiftDate(today, -61) })], shiftDate(today, -60));
    render(<PlannerStatsPage />);
    expect(screen.getByText("1 of 3 tasks done")).toBeTruthy(); // the last 30 days
    expect(screen.getByText("1 of 3 tasks done").previousElementSibling!.textContent).toBe("33%");
    expect(screen.getAllByText("Work").length).toBeGreaterThan(0);
    // It pulls every synced month, so other devices' days count too.
    expect(decodeURIComponent(requests(fetch, "/api/sync")[0].url.search)).toContain("planner-daily");

    fireEvent.click(screen.getByText("All time"));
    expect(screen.getByText("2 of 4 tasks done")).toBeTruthy();
    expect(screen.getByText("Old")).toBeTruthy(); // postponed once
    fireEvent.click(screen.getByText("7 days"));
    expect(screen.getByText("1 of 3 tasks done")).toBeTruthy();
    fireEvent.click(screen.getByText("90 days"));
    expect(screen.getByText("2 of 4 tasks done")).toBeTruthy();
  });

  it("takes in days that arrive from the server", async () => {
    const today = getTodayDate();
    routeFetch({
      "/api/sync": (_u, init) =>
        init?.method === "POST"
          ? { etag: '"e"' }
          : {
              docs: {
                [`planner-${today.slice(0, 7)}`]: {
                  etag: '"m"',
                  data: { items: [{ date: today, pos: 0, todo: todo("Remote", { completed: true }), updatedAt: 1 }] },
                },
              },
            },
    });
    render(<PlannerStatsPage />);
    expect(await screen.findByText("1 of 1 tasks done")).toBeTruthy();
  });

  it("charts database reads and writes per day, for the range chosen", async () => {
    const today = getTodayDate();
    const at = (date: string, reads: number, writes: number) => ({ t: `${date}T12:00`, reads, writes });
    routeFetch({
      "/api/usage": { buckets: [at(shiftDate(today, -40), 7, 3), at(today, 1200, 30)] },
    });
    render(<PlannerStatsPage />);
    expect(await screen.findByText("Database reads and writes")).toBeTruthy();
    expect(screen.getByText(/Reads · 1,200/)).toBeTruthy(); // the last 30 days leave out 40 days ago
    expect(screen.getByText(/Writes · 30/)).toBeTruthy();
    fireEvent.click(screen.getByText("All time"));
    expect(screen.getByText(/Reads · 1,207/)).toBeTruthy();
    expect(screen.getByText(/Writes · 33/)).toBeTruthy();
    fireEvent.click(screen.getByText("7 days"));
    expect(screen.getByLabelText(new RegExp(`1,200 reads, 30 writes`))).toBeTruthy();
  });

  it("shows an empty chart when there are no counts yet or they can't be loaded", async () => {
    routeFetch({ "/api/usage": () => new Response("{}", { status: 500 }) });
    const { unmount } = render(<PlannerStatsPage />);
    expect(await screen.findByText(/Reads · 0/)).toBeTruthy();
    unmount();
    routeFetch({ "/api/usage": () => Promise.reject(new Error("offline")) });
    render(<PlannerStatsPage />);
    expect(await screen.findByText(/Writes · 0/)).toBeTruthy();
    fireEvent.click(screen.getByText("All time"));
    expect(screen.getByText(/Reads · 0/)).toBeTruthy();
  });

  it("says the numbers cover all devices, unless the server couldn't be reached", async () => {
    routeFetch();
    const { unmount } = render(<PlannerStatsPage />);
    expect(await screen.findByText(/across all your devices/)).toBeTruthy();
    unmount();
    vi.spyOn(console, "error").mockImplementation(() => {});
    routeFetch({ "/api/sync": () => jsonResponse({}, { status: 500 }) });
    render(<PlannerStatsPage />);
    expect(await screen.findByText(/this browser's copy \(couldn't reach the server\)/)).toBeTruthy();
  });

  it("shows day log trends and says when patterns need more days", () => {
    routeFetch();
    const today = getTodayDate();
    const y = shiftDate(today, -1);
    updateDayLog(shiftDate(today, -2), { sleep: "23:00", weight: 72, water: 1000 });
    updateDayLog(y, { wake: "07:00", sleep: "23:30", weight: 71, water: 2500 });
    updateDayLog(today, { wake: "07:30" });
    saveTodos([todo("A")], y);
    render(<PlannerStatsPage />);
    expect(screen.getByText("8.0 h avg")).toBeTruthy();
    expect(screen.getByText("1.8 L avg")).toBeTruthy();
    expect(screen.getByText("71.0 kg latest")).toBeTruthy();
    expect(screen.getByText(/−1\.0 kg over this period/)).toBeTruthy();
    expect(screen.getAllByText(/Needs at least 5 days each way/).length).toBe(2);
  });

  it("states a pattern with its numbers, and a difference too small to matter", () => {
    routeFetch();
    const today = getTodayDate();
    for (let i = 1; i <= 10; i++) {
      const d = shiftDate(today, -i);
      const rested = i <= 5;
      updateDayLog(shiftDate(d, -1), { sleep: rested ? "22:00" : "02:00" });
      updateDayLog(d, { wake: "07:00", water: 1000 });
      saveTodos([todo(`A${i}`, { completed: rested }), todo(`B${i}`, { completed: true })], d);
    }
    render(<PlannerStatsPage />);
    expect(screen.getByText("You finish more of your tasks after 7+ hours of sleep: 100% vs. 50%.")).toBeTruthy();
    expect(screen.getByText("5 days that did, 5 that didn't")).toBeTruthy();
  });

  it("reports when a habit lines up with finishing less, or makes no difference", () => {
    routeFetch();
    const today = getTodayDate();
    for (let i = 1; i <= 10; i++) {
      const d = shiftDate(today, -i);
      const met = i <= 5;
      updateDayLog(d, { water: met ? 3000 : 500 });
      saveTodos([todo(`A${i}`, { completed: !met }), todo(`B${i}`, { completed: true })], d);
    }
    const { unmount } = render(<PlannerStatsPage />);
    expect(screen.getByText(/You finish less of your tasks on days you reached your 2\.5 L water goal: 50% vs\. 100%/)).toBeTruthy();
    unmount();
    for (let i = 1; i <= 10; i++) saveTodos([todo(`A${i}`, { completed: true })], shiftDate(today, -i));
    render(<PlannerStatsPage />);
    expect(screen.getByText("No clear difference so far.")).toBeTruthy();
  });

  it("compares with the period before, and leaves that out for all time", () => {
    routeFetch();
    const today = getTodayDate();
    updateDayLog(shiftDate(today, -40), { water: 1000 });
    updateDayLog(shiftDate(today, -2), { water: 2000 });
    render(<PlannerStatsPage />);
    expect(screen.getByText("+1.0 L vs. the period before")).toBeTruthy();
    expect(screen.getByText("┄ 2.5 L goal")).toBeTruthy();
    fireEvent.click(screen.getByText("All time"));
    expect(screen.getByText("Per day, leaving out today")).toBeTruthy();
    expect(screen.getByText("Hours slept the night before")).toBeTruthy();
    expect(screen.getByText("Log when you went to sleep and woke up to see this.")).toBeTruthy();
    expect(screen.getByText("Log your weight to see this.")).toBeTruthy();
  });

  it("says about the same when a change rounds to nothing", () => {
    routeFetch();
    const today = getTodayDate();
    updateDayLog(shiftDate(today, -40), { water: 2000 });
    updateDayLog(shiftDate(today, -2), { water: 2010 });
    render(<PlannerStatsPage />);
    expect(screen.getByText("About the same as the period before")).toBeTruthy();
  });

  it("hides the day log section when nothing is logged", () => {
    routeFetch();
    saveTodos([todo("A")], getTodayDate());
    render(<PlannerStatsPage />);
    expect(screen.queryByText("Patterns in your days")).toBeNull();
  });

  it("compares planned and actual time by tag and suggests a block length", () => {
    routeFetch();
    const y = shiftDate(getTodayDate(), -1);
    const done = (id: string, tag: Todo["tag"], spent: number, duration = 60) => todo(id, { tag, start: 540, duration, spent, completed: true });
    saveTodos(
      [
        done("w1", "work", 84), done("w2", "work", 84), done("w3", "work", 84),
        done("h1", "home", 60), done("h2", "home", 62), done("h3", "home", 58),
        done("l1", "learning", 30), done("l2", "learning", 30), done("l3", "learning", 30),
        done("n1", undefined, 90), done("n2", undefined, 90), done("n3", undefined, 90),
        done("thin1", "health", 90),
      ],
      y
    );
    render(<PlannerStatsPage />);
    expect(screen.getByText("Work tasks run 40% over")).toBeTruthy();
    expect(screen.getByText(/3 tasks · plan about 1h 25m instead of 1h/)).toBeTruthy();
    expect(screen.getByText("Home tasks run about as planned")).toBeTruthy();
    expect(screen.getByText("Learning tasks run 50% under")).toBeTruthy();
    expect(screen.getByText("Untagged tasks run 50% over")).toBeTruthy();
    expect(screen.queryByText(/Health tasks/)).toBeNull(); // too few to say
  });

  it("explains how to get planned vs. actual when there's nothing yet", () => {
    routeFetch();
    render(<PlannerStatsPage />);
    expect(screen.getByText(/Finish 3 time blocks with the same tag/)).toBeTruthy();
  });

  it("links the postponed list to the review and shows how many times", () => {
    routeFetch();
    const today = getTodayDate();
    saveTodos([todo("Taxes", { carriedFrom: shiftDate(today, -4), postponed: 3 })], today);
    render(<PlannerStatsPage />);
    expect(screen.getByText("3 times")).toBeTruthy();
    fireEvent.click(screen.getByText(/in the weekly review/));
    expect(onOpenReview).toHaveBeenCalled();
  });

  describe("day log history", () => {
    const row = (label: string) => screen.getByRole("rowheader", { name: new RegExp(`^${label}`) }).closest("tr")!;
    const cells = (label: string) => [...row(label).querySelectorAll("td")];

    it("shows a week of ticks and steps, with each item's rate, average and streak", () => {
      routeFetch();
      const today = getTodayDate();
      for (let i = 1; i <= 3; i++) setLogTick(shiftDate(today, -i), "bath", true);
      setLogTick(shiftDate(today, -5), "yoga", true);
      setLogCount(shiftDate(today, -1), "walk", 8000);
      setLogCount(shiftDate(today, -2), "walk", 450);
      render(<PlannerStatsPage />);
      fireEvent.click(screen.getByText("7 days"));
      expect(cells("Bath")).toHaveLength(7);
      expect(cells("Bath").map((c) => c.textContent)).toEqual(["", "", "", "✓", "✓", "✓", ""]);
      expect(row("Bath").querySelector("th")!.textContent).toContain("50% · 🔥 3"); // 3 of the 6 finished days
      expect(row("Yoga").querySelector("th")!.textContent).toBe("Yoga17%");
      expect(cells("Walk").map((c) => c.textContent).slice(4)).toEqual(["450", "8k", ""]);
      expect(row("Walk").querySelector("th")!.textContent).toContain("4,225 avg · 🔥 2");
      expect(screen.getByLabelText(`Walk, ${formatShortDate(shiftDate(today, -1))}: 8,000 steps`)).toBeTruthy();
      expect(screen.getByLabelText(`Bath, ${formatShortDate(today)}: not done`)).toBeTruthy();
      expect(screen.getByLabelText(`Walk, ${formatShortDate(today)}: nothing logged`)).toBeTruthy();
      expect(row("Med 1").querySelector("th")!.textContent).toBe("Med 10%");
      // Steps also get a trend.
      expect(screen.getByText("Walk trend")).toBeTruthy();
      expect(screen.getByText("4,225 steps avg")).toBeTruthy();
      expect(screen.getByLabelText(`${formatShortDate(shiftDate(today, -1))}: 8,000 steps`)).toBeTruthy();
    });

    it("shows a tick's time, and compact cells over longer periods", () => {
      routeFetch();
      const today = getTodayDate();
      setLogTick(today, "brush", true, 455);
      render(<PlannerStatsPage />);
      expect(cells("Brush")).toHaveLength(30);
      expect(screen.getByLabelText(`Brush, ${formatShortDate(today)}: done at 7:35 AM`)).toBeTruthy();
      expect(row("Brush").querySelector("th")!.textContent).toBe("Brush3% · 🔥 1");
      expect(screen.queryByText("Walk trend")).toBeNull();
    });

    it("keeps a removed item's history under All", () => {
      routeFetch();
      setLogTick(shiftDate(getTodayDate(), -1), "stools", true);
      removeLogItem("stools");
      render(<PlannerStatsPage />);
      expect(screen.queryByRole("rowheader", { name: /^Stools/ })).toBeNull();
      fireEvent.click(screen.getByText("All, with removed"));
      expect(row("Stools").querySelector("th")!.textContent).toContain("🔥 1");
      fireEvent.click(screen.getByText("Shown"));
      expect(screen.queryByRole("rowheader", { name: /^Stools/ })).toBeNull();
    });

    it("offers no All view when nothing was removed", () => {
      routeFetch();
      render(<PlannerStatsPage />);
      expect(screen.queryByText("All, with removed")).toBeNull();
    });
  });
});
