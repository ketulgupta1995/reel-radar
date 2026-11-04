// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jsonResponse } from "@/test/fixtures";
import { requests, routeFetch } from "@/test/pages";
import { addItem, addList } from "@/lib/lists";
import { MAX_TASK_HITS } from "@/lib/plannerSearch";
import { addGoal, setGoalDone, loadGoals } from "@/lib/plannerSettings";
import { saveDailyTasks, saveTodos, updateDayLog, type Todo } from "@/lib/todos";

vi.mock("next/navigation", () => ({ usePathname: () => "/todos/search" }));

import PlannerSearchPage from "./page";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-03-01T00:00:00.000Z", ...extra });
const search = (text: string) => fireEvent.change(screen.getByLabelText("Search the whole planner"), { target: { value: text } });
const hrefOf = (text: string | RegExp) => screen.getByText(text).closest("a")!.getAttribute("href");

let fetchMock: ReturnType<typeof routeFetch>;
beforeEach(() => {
  fetchMock = routeFetch();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("PlannerSearchPage", () => {
  it("shows nothing until you type, then what's in tasks, notes, goals and lists", async () => {
    saveTodos([todo("Call dentist", { completed: true, note: "ask about the crown" }), todo("Gym")], "2026-03-02");
    saveTodos([todo("Dentist forms")], "2026-03-09");
    updateDayLog("2026-03-03", { bad: "The dentist ran late" });
    addGoal("See the dentist twice");
    setGoalDone(loadGoals()[0].id, true);
    const list = addList("Gifts");
    addItem(list.id, "Dentist voucher");
    addItem(list.id, "Dentist floss", { done: true });
    render(<PlannerSearchPage />);
    expect(screen.queryByText("Tasks")).toBeNull();
    search("  DENTIST ");
    expect(hrefOf("Dentist forms")).toBe("/todos?date=2026-03-09");
    expect(hrefOf("✓ Call dentist")).toBe("/todos?date=2026-03-02");
    expect(screen.getByText("ask about the crown")).toBeTruthy();
    expect(screen.queryByText("Gym")).toBeNull();
    expect(hrefOf("✓ See the dentist twice")).toBe("/todos/goals");
    expect(hrefOf("The dentist ran late")).toBe("/todos?date=2026-03-03");
    expect(screen.getByText(/Went badly/)).toBeTruthy();
    const voucher = hrefOf("Dentist voucher")!;
    expect(voucher).toContain(`/todos/lists?list=${list.id}&item=`);
    expect(screen.getByText("✓ Dentist floss")).toBeTruthy();
    expect(screen.getAllByText("Gifts")).toHaveLength(2);
  });

  it("answers when something was last done, for a repeating task", async () => {
    saveDailyTasks([{ id: "d", text: "Swim", startDate: "2026-03-01" }, { id: "e", text: "Swim laps", startDate: "2026-03-01" }]);
    saveTodos([todo("d:1", { text: "Swim", dailyId: "d", completed: true })], "2026-03-01");
    saveTodos([todo("d:4", { text: "Swim", dailyId: "d", completed: true })], "2026-03-04");
    saveTodos([todo("d:5", { text: "Swim", dailyId: "d" })], "2026-03-05");
    render(<PlannerSearchPage />);
    search("swim");
    expect(screen.getByText("Done 2× · last Mar 4")).toBeTruthy();
    expect(hrefOf("↻ Swim")).toBe("/todos?date=2026-03-04");
    expect(screen.getByText("Not done yet")).toBeTruthy();
  });

  it("says when nothing matches", () => {
    render(<PlannerSearchPage />);
    search("zzz");
    expect(screen.getByText("Nothing matches “zzz”.")).toBeTruthy();
  });

  it("starts from a search in the address", async () => {
    saveTodos([todo("Gym")], "2026-03-02");
    window.history.replaceState(null, "", "/todos/search?q=gym");
    render(<PlannerSearchPage />);
    expect(await screen.findByText("Gym")).toBeTruthy();
  });

  it("caps long results and asks for another word", () => {
    saveTodos(Array.from({ length: MAX_TASK_HITS + 1 }, (_, i) => todo(`Task ${i}`)), "2026-03-02");
    render(<PlannerSearchPage />);
    search("task");
    expect(screen.getByText(`Showing the latest ${MAX_TASK_HITS}. Add a word to narrow it down.`)).toBeTruthy();
    expect(screen.getByRole("heading", { name: `Tasks ${MAX_TASK_HITS + 1}` })).toBeTruthy();
  });

  it("pulls everything once when it opens, not as you type", async () => {
    render(<PlannerSearchPage />);
    await waitFor(() => expect(requests(fetchMock, "/api/sync").length).toBeGreaterThan(0));
    const before = fetchMock.mock.calls.length;
    search("g");
    search("gy");
    search("gym");
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("finds what another device added, once the pull is back", async () => {
    const item = { date: "2026-03-02", pos: 0, todo: todo("From phone"), updatedAt: 1 };
    routeFetch({ "/api/sync": (url: URL) => {
      const keys = url.searchParams.get("keys") ?? "";
      return keys.includes("planner-2026-10") ? { docs: { "planner-2026-10": { etag: '"e"', data: { items: [{ ...item, date: "2026-10-02" }] } } } } : { docs: {} };
    } });
    render(<PlannerSearchPage />);
    search("phone");
    expect(await screen.findByText("From phone")).toBeTruthy();
  });

  it("says so when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { status: 500 })));
    render(<PlannerSearchPage />);
    expect(await screen.findByText(/only searches what's on this device/)).toBeTruthy();
  });
});
