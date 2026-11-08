// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { requests, routeFetch } from "@/test/pages";
import { addGoal, loadGoals, setGoalDone } from "@/lib/plannerSettings";
import { loadDailyTasks, loadTodos, saveDailyTasks, saveTodos, type Todo } from "@/lib/todos";

import { Goals } from "./Goals";

const onOpenDay = vi.fn();
const onMessage = vi.fn();
const GoalsPage = () => <Goals onOpenDay={onOpenDay} onMessage={onMessage} />;

// Thursday 2026-03-05, in the week of Monday 2026-03-02.
const TODAY = "2026-03-05";
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-03-01T00:00:00.000Z", ...extra });
const card = (name: string) => within(screen.getByRole("heading", { name }).closest("li") as HTMLElement);

let fetchMock: ReturnType<typeof routeFetch>;
beforeEach(() => {
  fetchMock = routeFetch();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 5, 12));
});
afterEach(() => vi.useRealTimers());

describe("Goals in Plans", () => {
  it("starts empty, adds a goal, and pulls every month once", async () => {
    render(<GoalsPage />);
    expect(await screen.findByText(/No goals yet/)).toBeTruthy();
    fireEvent.click(screen.getByText("Add goal"));
    expect(screen.getByText("Give the goal a name")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New goal"), { target: { value: "Run 10K" } });
    fireEvent.change(screen.getByLabelText("Goal date (optional)"), { target: { value: "2026-03-15" } });
    fireEvent.click(screen.getByText("Add goal"));
    expect(loadGoals()[0]).toMatchObject({ name: "Run 10K", by: "2026-03-15" });
    expect(screen.getByRole("heading", { name: "Run 10K" })).toBeTruthy();
    expect(screen.getByText("By Mar 15 · 10 days left")).toBeTruthy();
    expect((screen.getByLabelText("New goal") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Give the goal a name")).toBeNull();
    await waitFor(() => expect(requests(fetchMock, "/api/sync").length).toBeGreaterThan(0));
    expect(requests(fetchMock, "/api/sync")[0].url.searchParams.get("keys")).toContain("planner-settings");
  });

  it("says how close the date is, today or past", async () => {
    addGoal("Today goal", TODAY);
    addGoal("One day", "2026-03-06");
    addGoal("Past goal", "2026-03-03");
    render(<GoalsPage />);
    expect(await screen.findByText("By Mar 5 · today")).toBeTruthy();
    expect(screen.getByText("By Mar 6 · 1 day left")).toBeTruthy();
    expect(screen.getByText("By Mar 3 · 2 days past")).toBeTruthy();
  });

  it("shows progress, repeats and the next step", async () => {
    addGoal("Run");
    const goalId = loadGoals()[0].id;
    saveTodos([todo("Shoes", { goalId, completed: true, doneAt: new Date(2026, 2, 3, 12).getTime(), spent: 30 })], "2026-03-03");
    saveTodos([todo("Missed step", { goalId })], "2026-03-01");
    saveTodos([todo("Next step", { goalId })], "2026-03-09");
    saveDailyTasks([{ id: "d", text: "Jog", startDate: "2026-03-01", timesPerWeek: 3, goalId }]);
    render(<GoalsPage />);
    await screen.findByRole("heading", { name: "Run" });
    const c = card("Run");
    expect(c.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
    expect(c.getByText("1 done · 1 this week · 2 still open · 30m focused · last Mar 3")).toBeTruthy();
    expect(c.getByText(/Jog/)).toBeTruthy();
    expect(c.getByText("3× a week")).toBeTruthy();
    fireEvent.click(c.getByRole("button", { name: /^Next: Next step/ }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-03-09");
    fireEvent.click(c.getByLabelText("Move “Next step” to today"));
    await waitFor(() => expect(loadTodos(TODAY).map((t) => t.id)).toEqual(["Next step"]));
    expect(onMessage).toHaveBeenCalledWith("Moved “Next step” to today");
    await waitFor(() => expect(c.queryByLabelText("Move “Next step” to today")).toBeNull()); // it's today's now
    expect(c.queryByText(/No next step/)).toBeNull();
  });

  it("falls back to an overdue step as next, and asks for one when there's none", async () => {
    addGoal("Run");
    addGoal("Read");
    const [run] = loadGoals();
    saveTodos([todo("Missed step", { goalId: run.id })], "2026-03-01");
    render(<GoalsPage />);
    await screen.findByRole("heading", { name: "Run" });
    expect(card("Run").getByRole("button", { name: /^Next: Missed step/ })).toBeTruthy();
    expect(card("Read").getByText(/No next step planned/)).toBeTruthy();
    expect(card("Read").queryByRole("progressbar")).toBeNull();
  });

  it("adds steps with the shorthand: for today, another day, or repeating", async () => {
    addGoal("Run");
    const goalId = loadGoals()[0].id;
    render(<GoalsPage />);
    const box = await screen.findByLabelText("Add a step to “Run”");
    fireEvent.submit(box); // nothing typed yet
    fireEvent.change(box, { target: { value: "Stretch 6pm 45m !high" } });
    fireEvent.submit(box);
    await waitFor(() => expect(loadTodos(TODAY)).toHaveLength(1));
    expect(loadTodos(TODAY)[0]).toMatchObject({ text: "Stretch", goalId, start: 18 * 60, duration: 45, priority: "high" });
    await screen.findByText("0 done · 0 this week · 1 still open");
    expect((box as HTMLInputElement).value).toBe("");

    fireEvent.change(box, { target: { value: "Race 15 mar by 20 mar" } });
    fireEvent.submit(box);
    await waitFor(() => expect(loadTodos("2026-03-15")).toHaveLength(1));
    expect(loadTodos("2026-03-15")[0]).toMatchObject({ text: "Race", goalId, due: "2026-03-20" });

    fireEvent.change(box, { target: { value: "Jog 3x week" } });
    fireEvent.submit(box);
    await waitFor(() => expect(loadDailyTasks()).toHaveLength(1));
    expect(loadDailyTasks()[0]).toMatchObject({ text: "Jog", goalId, timesPerWeek: 3 });
  });

  it("edits a goal's name and date", async () => {
    addGoal("Run", "2026-03-15");
    render(<GoalsPage />);
    await screen.findByRole("heading", { name: "Run" });
    fireEvent.click(screen.getByText("Edit"));
    const name = screen.getByLabelText("Name of “Run”");
    fireEvent.blur(Object.assign(name, { value: "Run far" }));
    expect(loadGoals()[0].name).toBe("Run far");
    fireEvent.change(screen.getByLabelText("Date of “Run far”"), { target: { value: "" } });
    expect(loadGoals()[0].by).toBeUndefined();
    fireEvent.click(screen.getByText("Done editing"));
    expect(screen.getByRole("heading", { name: "Run far" })).toBeTruthy();
  });

  it("marks a goal achieved, and reopens it", async () => {
    addGoal("Run");
    render(<GoalsPage />);
    await screen.findByRole("heading", { name: "Run" });
    fireEvent.click(screen.getByText("Mark achieved"));
    expect(loadGoals()[0].doneAt).toBeTypeOf("number");
    expect(screen.queryByText("✓ Run")).toBeNull(); // folded away
    fireEvent.click(screen.getByText("Achieved · 1 ▾"));
    expect(screen.getByText("✓ Run")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Reopen “Run”"));
    expect(loadGoals()[0].doneAt).toBeUndefined();
    expect(screen.queryByText(/^Achieved/)).toBeNull();
  });

  it("asks once more before deleting, and leaves the tasks", async () => {
    addGoal("Run");
    const goalId = loadGoals()[0].id;
    saveTodos([todo("Shoes", { goalId })], TODAY);
    render(<GoalsPage />);
    await screen.findByRole("heading", { name: "Run" });
    fireEvent.click(screen.getByText("Delete"));
    expect(loadGoals()).toHaveLength(1);
    fireEvent.click(screen.getByText(/Really delete/));
    expect(loadGoals()).toEqual([]);
    expect(loadTodos(TODAY)[0].text).toBe("Shoes");
    expect(screen.queryByRole("heading", { name: "Run" })).toBeNull();
  });

  it("still invites a new goal when only achieved ones remain", async () => {
    addGoal("Run");
    setGoalDone(loadGoals()[0].id, true);
    render(<GoalsPage />);
    expect(await screen.findByText(/No goals yet/)).toBeTruthy();
    expect(screen.getByText("Achieved · 1 ▾")).toBeTruthy();
  });

  it("colours a tile by the tag its steps use most, and outlines one with no next step", async () => {
    addGoal("Run");
    addGoal("Read");
    const [run] = loadGoals();
    saveTodos([todo("Shoes", { goalId: run.id, tag: "health" }), todo("Plan", { goalId: run.id, tag: "health" }), todo("Call", { goalId: run.id, tag: "work" })], TODAY);
    render(<GoalsPage />);
    await screen.findByRole("heading", { name: "Run" });
    expect(screen.getByRole("listitem", { name: "Run" }).getAttribute("style")).toContain("background");
    expect(card("Run").getByText("Health")).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "Read" }).className).toContain("ring-bf-late");
  });
});
