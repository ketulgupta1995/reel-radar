// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { routeFetch } from "@/test/pages";
import { addList, loadItems, loadLists } from "@/lib/lists";
import { addGoal, loadGoals, setGoalDone } from "@/lib/plannerSettings";
import { type Todo, addTodo, loadDayLog, loadTodos, saveTodos, updateDayLog } from "@/lib/todos";

import { Review } from "./Review";

const onDone = vi.fn();
const onOpenWeek = vi.fn();
const WeeklyReviewPage = () => <Review onDone={onDone} onOpenWeek={onOpenWeek} />;

// Sunday 2026-03-08 ends the week of Monday 2026-03-02.
const SUN = "2026-03-08";
const MON = "2026-03-02";
const NEXT_MON = "2026-03-09";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-03-01T00:00:00.000Z", ...extra });

beforeEach(() => {
  routeFetch();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 2, 8, 12, 0));
});
afterEach(() => vi.useRealTimers());

const open = async () => {
  render(<WeeklyReviewPage />);
  return screen.findByText("Weekly review");
};
const goTo = (step: string) => fireEvent.click(screen.getByRole("button", { name: step }));

describe("WeeklyReviewPage", () => {
  it("looks back on the week: results, what slipped, and the notes you made", async () => {
    saveTodos(
      [
        todo("Ship", { completed: true, start: 540, duration: 60, spent: 45 }),
        todo("Late", { carriedFrom: "2026-02-28" }),
        todo("Sorted", { completed: true, carriedFrom: "2026-03-01" }),
      ],
      MON
    );
    saveTodos([todo("Last week", { completed: true })], "2026-03-01");
    updateDayLog(MON, { well: "Shipped it", bad: "Slept late", improve: "Plan less" });
    await open();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("of 1h planned")).toBeTruthy();
    expect(screen.getByText("What kept slipping")).toBeTruthy();
    expect(screen.getByText("2 days late")).toBeTruthy();
    expect(screen.getByText("✓ Done")).toBeTruthy();
    expect(screen.getByText("Shipped it")).toBeTruthy();
    expect(screen.getByText("Slept late")).toBeTruthy();
    expect(screen.getByText("Plan less")).toBeTruthy();
  });

  it("keeps the look back simple when there's nothing to report", async () => {
    await open();
    expect(screen.getByText("0 of 0")).toBeTruthy();
    expect(screen.queryByText("What kept slipping")).toBeNull();
    expect(screen.queryByText("What you noted")).toBeNull();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Nothing left unfinished. Nice.")).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Finished")).toBeTruthy();
  });

  it("reschedules an unfinished task, counting the postponement, from any past week", async () => {
    saveTodos([todo("Ancient")], "2026-02-01");
    saveTodos([todo("Today's")], SUN);
    saveTodos([todo("Done", { completed: true })], MON);
    addTodo("Repeats", MON, undefined, undefined, true);
    await open();
    goTo("Unfinished tasks");
    expect(screen.getByText("2 unfinished tasks. Pick a day, drop it, or move it to a list. Anything you leave stays overdue.")).toBeTruthy();
    const days = within(screen.getByRole("group", { name: "Reschedule “Ancient”" }));
    fireEvent.click(days.getByText("Mon 9"));
    expect(loadTodos("2026-02-01")).toEqual([]);
    expect(loadTodos(NEXT_MON)[0]).toMatchObject({ id: "Ancient", postponed: 1, carriedFrom: "2026-02-01" });
    expect(screen.queryByText("Ancient")).toBeNull();
  });

  it("drops a task, with undo", async () => {
    saveTodos([todo("Stale")], MON);
    await open();
    goTo("Unfinished tasks");
    fireEvent.click(screen.getByText("Drop"));
    expect(loadTodos(MON)).toEqual([]);
    expect(screen.getByText("Dropped “Stale”")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    expect(loadTodos(MON).map((t) => t.id)).toEqual(["Stale"]);
    expect(screen.queryByText("Dropped “Stale”")).toBeNull();
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Finish review"));
    expect(screen.queryByText(/dropped/)).toBeNull();
  });

  it("moves a task to a chosen list", async () => {
    const list = addList("Someday", "💡");
    saveTodos([todo("Learn piano", { note: "keys" })], MON);
    await open();
    goTo("Unfinished tasks");
    fireEvent.change(screen.getByLabelText("Move “Learn piano” to a list"), { target: { value: list.id } });
    expect(loadTodos(MON)).toEqual([]);
    expect(loadItems(list.id)[0]).toMatchObject({ text: "Learn piano", note: "keys" });
  });

  it("makes a list when there are none yet", async () => {
    saveTodos([todo("Learn piano")], MON);
    await open();
    goTo("Unfinished tasks");
    const select = screen.getByLabelText("Move “Learn piano” to a list");
    fireEvent.change(select, { target: { value: "" } });
    expect(loadTodos(MON)).toHaveLength(1);
    fireEvent.change(select, { target: { value: "new" } });
    expect(loadLists().map((l) => l.name)).toEqual(["Things to remember"]);
    expect(loadItems(loadLists()[0].id).map((i) => i.text)).toEqual(["Learn piano"]);
  });

  it("asks to drop or break down what keeps slipping", async () => {
    saveTodos([todo("Taxes", { postponed: 3 })], MON);
    await open();
    goTo("Unfinished tasks");
    expect(screen.getByText(/postponed 3×/)).toBeTruthy();
    fireEvent.click(screen.getByText("Break it down"));
    fireEvent.change(screen.getByLabelText("A smaller step for “Taxes”"), { target: { value: "Find forms" } });
    fireEvent.click(screen.getByText("Add step"));
    expect(loadTodos(MON)[0].subtasks!.map((s) => s.text)).toEqual(["Find forms"]);
    fireEvent.click(screen.getByText("Drop it"));
    expect(loadTodos(MON)).toEqual([]);
  });

  it("plans next week with shorthand, showing what's already there", async () => {
    saveTodos([todo("Booked", { start: 600, duration: 90 })], NEXT_MON);
    addTodo("Walk", MON, undefined, { start: 420, duration: 30 }, [2]); // Tuesdays
    await open();
    goTo("Plan ahead");
    expect(screen.getByText("· Booked")).toBeTruthy();
    expect(screen.getByText("1h 30m scheduled")).toBeTruthy();
    expect(screen.getByText(/1 repeating/)).toBeTruthy();
    expect(screen.getAllByText("nothing scheduled").length).toBe(5);
    const inputs = screen.getAllByPlaceholderText("Add a task");
    fireEvent.submit(inputs[1]); // nothing typed
    fireEvent.change(inputs[1], { target: { value: "Gym 6pm 45m #health" } });
    fireEvent.submit(inputs[1]);
    expect(loadTodos("2026-03-10")[0]).toMatchObject({ text: "Gym", start: 18 * 60, duration: 45, tag: "health" });
    fireEvent.change(inputs[2], { target: { value: "Call home" } });
    fireEvent.submit(inputs[2]);
    expect(loadTodos("2026-03-11")[0].start).toBeUndefined();
    fireEvent.click(screen.getByText("Finish review"));
    expect(screen.getByText("Review done")).toBeTruthy();
    expect(screen.getByText("2 added to your plan")).toBeTruthy();
  });

  it("records the review on the week's Sunday and sums up what was decided", async () => {
    const list = addList("Someday");
    saveTodos([todo("One"), todo("Two"), todo("Three")], MON);
    await open();
    goTo("Unfinished tasks");
    fireEvent.click(within(screen.getByRole("group", { name: "Reschedule “One”" })).getByText("Mon 9"));
    fireEvent.click(screen.getAllByText("Drop")[0]);
    fireEvent.change(screen.getByLabelText("Move “Three” to a list"), { target: { value: list.id } });
    goTo("Plan ahead");
    fireEvent.click(screen.getByText("Finish review"));
    expect(screen.getByText("1 rescheduled · 1 dropped · 1 moved to a list")).toBeTruthy();
    expect(loadDayLog(SUN).reviewedAt).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Back to Plans"));
    expect(onDone).toHaveBeenCalled();
  });

  it("midweek, reviews the week that ended, takes every missed day, and offers only the days left", async () => {
    vi.setSystemTime(new Date(2026, 2, 11, 12, 0)); // Wednesday
    saveTodos([todo("Left over")], MON);
    saveTodos([todo("This week's")], "2026-03-10");
    await open();
    goTo("Unfinished tasks");
    expect(screen.getByText("This week's")).toBeTruthy(); // missed days this week count too
    saveTodos([todo("Today's", { createdAt: "x" })], "2026-03-11");
    const days = within(screen.getByRole("group", { name: "Reschedule “Left over”" }));
    expect(days.queryByText("Mon 9")).toBeNull();
    expect(days.getByText("Wed 11")).toBeTruthy();
  });

  it("takes in what arrives from the server, and forgets the undo after a while", async () => {
    vi.useRealTimers();
    routeFetch();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 2, 8, 12, 0));
    saveTodos([todo("Stale")], MON);
    await open();
    goTo("Unfinished tasks");
    fireEvent.click(screen.getByText("Drop"));
    act(() => void vi.advanceTimersByTime(6000));
    await waitFor(() => expect(screen.queryByText("Undo")).toBeNull());
  });
});

describe("goals in the weekly review", () => {
  it("shows how each goal went, and which have no next step", async () => {
    addGoal("Run");
    addGoal("Read");
    addGoal("Write");
    addGoal("Old");
    const [run, read, , old] = loadGoals();
    setGoalDone(old.id, true);
    saveTodos([todo("Ran", { goalId: run.id, completed: true, doneAt: new Date(2026, 2, 3, 12).getTime() }), todo("Run more", { goalId: run.id })], MON);
    saveTodos([todo("Chapter", { goalId: read.id })], NEXT_MON);
    await open();
    expect(screen.getByText("Your goals")).toBeTruthy();
    expect(screen.queryByText("Old")).toBeNull();
    const card = (name: string) => within(screen.getByText(name).closest("li") as HTMLElement);
    expect(card("Run").getByText("1 done this week · 1 open")).toBeTruthy();
    expect(card("Run").getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(card("Read").getByText("Nothing moved this week.")).toBeTruthy();
    expect(card("Write").getByText(/No next step planned/)).toBeTruthy();
    expect(card("Write").queryByRole("progressbar")).toBeNull();
  });

  it("shows the deadline of an unfinished task", async () => {
    saveTodos([todo("Tax", { due: "2026-03-07" })], MON);
    await open();
    goTo("Unfinished tasks");
    expect(screen.getByText("1 day late")).toBeTruthy();
  });

  it("links tasks you plan to a goal, and reads a deadline from the shorthand", async () => {
    addGoal("Run");
    const goalId = loadGoals()[0].id;
    await open();
    goTo("Plan ahead");
    fireEvent.change(await screen.findByLabelText(/Tasks you add work towards/), { target: { value: goalId } });
    const box = screen.getByLabelText("Add a task for Mar 9");
    fireEvent.change(box, { target: { value: "Long run by wed" } });
    fireEvent.submit(box);
    await waitFor(() => expect(loadTodos(NEXT_MON)).toHaveLength(1));
    expect(loadTodos(NEXT_MON)[0]).toMatchObject({ text: "Long run", goalId, due: "2026-03-11" });
  });

  it("offers no goal choice without goals", async () => {
    await open();
    expect(screen.queryByText("Your goals")).toBeNull();
    goTo("Plan ahead");
    expect(screen.queryByLabelText(/Tasks you add work towards/)).toBeNull();
    const box = screen.getByLabelText("Add a task for Mar 9");
    fireEvent.change(box, { target: { value: "Plain" } });
    fireEvent.submit(box);
    await waitFor(() => expect(loadTodos(NEXT_MON)).toHaveLength(1));
    expect(loadTodos(NEXT_MON)[0].goalId).toBeUndefined();
  });
});
