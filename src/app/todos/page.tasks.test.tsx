// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { routeFetch } from "@/test/pages";
import { addGoal, loadGoals } from "@/lib/plannerSettings";
import { getFocusSession, loadTodos, saveTodos, updateDayLog } from "@/lib/todos";
import { T, todo, at, open, tasks, flashed, add, FakeNotification, resetNotifications, dragTo, box } from "@/test/planner";

vi.mock("next/navigation", () => ({ usePathname: () => "/todos" }));

let fetchMock: ReturnType<typeof routeFetch>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(9, 40);
  fetchMock = routeFetch();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("task details", () => {
  const details = () => within(screen.getByRole("dialog", { name: "Task details" }));
  const openTask = async (text: string) => {
    fireEvent.click(await tasks().findByLabelText(`Open “${text}”`));
    return details();
  };
  const saved = (id = "Report") => loadTodos(T).find((t) => t.id === id)!;

  it("edits the title and note, and an emptied title deletes the task with undo", async () => {
    saveTodos([todo("Report", { note: "Draft" })], T);
    open();
    const d = await openTask("Report");
    expect((d.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Draft");
    fireEvent.change(d.getByLabelText("Title"), { target: { value: "Quarterly report" } });
    fireEvent.keyDown(d.getByLabelText("Title"), { key: "Enter" });
    fireEvent.blur(d.getByLabelText("Title"));
    expect(saved().text).toBe("Quarterly report");
    fireEvent.change(d.getByLabelText("Note"), { target: { value: "Numbers first" } });
    fireEvent.blur(d.getByLabelText("Note"));
    expect(saved().note).toBe("Numbers first");
    fireEvent.change(d.getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.blur(d.getByLabelText("Title"));
    expect(loadTodos(T)).toEqual([]);
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    expect(await flashed("Deleted “Quarterly report”")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(loadTodos(T).map((t) => t.text)).toEqual(["Quarterly report"]));
  });

  it("keeps a checklist, sets the time, length, priority and tag", async () => {
    saveTodos([todo("Report")], T);
    open();
    const d = await openTask("Report");
    fireEvent.change(d.getByLabelText("New checklist item"), { target: { value: "Pull numbers" } });
    fireEvent.submit(d.getByLabelText("New checklist item"));
    fireEvent.submit(d.getByLabelText("New checklist item")); // empty: nothing added
    expect(saved().subtasks).toMatchObject([{ text: "Pull numbers", done: false }]);
    fireEvent.click(d.getByLabelText("Tick “Pull numbers”"));
    expect(saved().subtasks![0].done).toBe(true);
    fireEvent.click(d.getByLabelText("Untick “Pull numbers”"));
    fireEvent.click(d.getByLabelText("Remove “Pull numbers”"));
    expect(saved().subtasks ?? []).toEqual([]);

    expect((d.getByLabelText("Length") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(d.getByRole("button", { name: "Starts: not set" }));
    fireEvent.click(screen.getByLabelText("2 o'clock"));
    fireEvent.click(screen.getByLabelText("30 minutes"));
    fireEvent.click(within(screen.getAllByRole("dialog")[1]).getByText("PM"));
    fireEvent.click(within(screen.getAllByRole("dialog")[1]).getByText("Done"));
    expect(saved()).toMatchObject({ start: 870, duration: 60 });
    fireEvent.change(d.getByLabelText("Length"), { target: { value: "90" } });
    expect(saved().duration).toBe(90);
    fireEvent.click(d.getByRole("button", { name: /^Starts:/ }));
    fireEvent.click(within(screen.getAllByRole("dialog")[1]).getByText("Clear"));
    expect(saved().start).toBeUndefined();

    fireEvent.click(within(d.getByRole("group", { name: "Priority" })).getByText("High"));
    expect(saved().priority).toBe("high");
    expect(within(d.getByRole("group", { name: "Priority" })).getByText("High").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(d.getByRole("group", { name: "Priority" })).getByText("None"));
    expect(saved().priority).toBeUndefined();
    fireEvent.click(within(d.getByRole("group", { name: "Tag" })).getByText("Work"));
    expect(saved().tag).toBe("work");
    fireEvent.click(within(d.getByRole("group", { name: "Tag" })).getByText("None"));
    expect(saved().tag).toBeUndefined();
  });

  it("shows a removed tag the task still has", async () => {
    localStorage.setItem("reel-radar-planner-settings", JSON.stringify({ tags: [{ value: { id: "home", label: "Home", color: "#d95926", removed: true }, updatedAt: 1 }], templates: [], goals: [] }));
    saveTodos([todo("Report", { tag: "home" })], T);
    open();
    const d = await openTask("Report");
    expect(within(d.getByRole("group", { name: "Tag" })).getByText("Home").getAttribute("aria-pressed")).toBe("true");
  });

  it("suggests a realistic length from how long blocks with that tag took", async () => {
    const past = [1, 2, 3].map((n) => todo(`Old ${n}`, { start: 600, duration: 60, tag: "work", completed: true, spent: 90 }));
    saveTodos(past, "2026-11-02");
    saveTodos([todo("Report", { start: 900, duration: 60, tag: "work" })], T);
    open();
    const d = await openTask("Report");
    expect(d.getByText(/usually run over: about 1h 30m/)).toBeTruthy();
    fireEvent.click(d.getByText("Use 1h 30m"));
    expect(saved().duration).toBe(90);
  });

  it("makes a task repeat, changes how, and stops it", async () => {
    saveTodos([todo("Stretch")], T);
    open();
    let d = await openTask("Stretch");
    fireEvent.click(d.getByText("Make it repeat"));
    expect(await flashed("Repeats every day from now on")).toBeTruthy();
    expect(saved("Stretch").dailyId).toBeTruthy();
    d = details();
    expect(d.queryByLabelText("Deadline")).toBeNull(); // a repeat has no deadline
    fireEvent.change(d.getByLabelText("How it repeats"), { target: { value: "timesPerWeek" } });
    expect(await screen.findByText("0 of 3 this week")).toBeTruthy();
    fireEvent.click(details().getByText("Stop repeating"));
    expect(await flashed("No longer repeats")).toBeTruthy();
    expect(saved("Stretch").dailyId).toBeUndefined();
  });

  it("sets and clears a deadline and a goal, and warns when planned after the deadline", async () => {
    addGoal("Q4 launch");
    saveTodos([todo("Report")], T);
    open();
    const d = await openTask("Report");
    fireEvent.change(d.getByLabelText("Deadline"), { target: { value: "2026-11-06" } });
    expect(saved().due).toBe("2026-11-06");
    expect(d.getByText("Planned after its deadline.")).toBeTruthy();
    fireEvent.click(d.getByText("Clear"));
    expect(saved().due).toBeUndefined();
    fireEvent.change(d.getByLabelText("Goal"), { target: { value: loadGoals()[0].id } });
    expect(saved().goalId).toBe(loadGoals()[0].id);
    fireEvent.change(d.getByLabelText("Goal"), { target: { value: "" } });
    expect(saved().goalId).toBeUndefined();
  });

  it("moves or copies a task to another day, and says when a move passes its deadline", async () => {
    saveTodos([todo("Report", { due: "2026-11-09", start: 600 }), todo("Daily", { dailyId: "d1" })], T);
    open();
    let d = await openTask("Report");
    expect((d.getByLabelText("Day to move or copy to") as HTMLInputElement).value).toBe("2026-11-09");
    fireEvent.click(d.getByText("Copy"));
    expect(await flashed("Copied to Tomorrow")).toBeTruthy();
    expect(loadTodos("2026-11-09")[0]).toMatchObject({ text: "Report", start: 600 });
    fireEvent.change(d.getByLabelText("Day to move or copy to"), { target: { value: "2026-11-12" } });
    fireEvent.click(d.getByText("Move"));
    expect(await flashed(/Moved to .*Nov 12.*, past its Nov 9 deadline/)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    expect(loadTodos("2026-11-12")[0]).toMatchObject({ text: "Report", start: 600 });
    d = await openTask("Daily");
    fireEvent.click(d.getByText("Move"));
    expect(await flashed("Repeating tasks stay on their own day. Copy it instead.")).toBeTruthy();
  });

  it("starts focus, deletes with undo, and closes with ✕, Escape or a tap outside", async () => {
    saveTodos([todo("Report"), todo("Other")], T);
    open();
    let d = await openTask("Report");
    fireEvent.click(d.getByLabelText("Close"));
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    await openTask("Report");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    await openTask("Report");
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    d = await openTask("Other");
    fireEvent.click(d.getByText("Delete"));
    expect(await flashed("Deleted “Other”")).toBeTruthy();
    expect(loadTodos(T).map((t) => t.id)).toEqual(["Report"]);
    d = await openTask("Report");
    fireEvent.click(d.getByText("▶ Start focus"));
    expect(getFocusSession()).toMatchObject({ todoId: "Report" });
    expect(screen.getByRole("dialog", { name: "Focus" })).toBeTruthy();
  });

  it("asks to drop or break down a task postponed three times", async () => {
    saveTodos([todo("Bike brakes", { postponed: 3 })], T);
    open();
    const d = await openTask("Bike brakes");
    expect(d.getByText(/Postponed 3 times/)).toBeTruthy();
    fireEvent.click(d.getByText("Drop it"));
    expect(loadTodos(T)).toEqual([]);
  });
});

describe("full-screen focus", () => {
  it("fills the screen, keeps it on, ticks the checklist, and minimises into the card", async () => {
    const request = vi.fn(async () => ({ release: vi.fn(async () => {}) }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    saveTodos([todo("Report", { start: 570, duration: 90, tag: "work", subtasks: [{ id: "s1", text: "Pull numbers", done: false }] })], T);
    open();
    fireEvent.click(within(await screen.findByRole("region", { name: "Under way" })).getByText("▶ Focus"));
    const screenFocus = within(screen.getByRole("dialog", { name: "Focus" }));
    expect(screenFocus.getByTestId("focus-big-clock").textContent).toBe("1:30:00");
    expect(request).toHaveBeenCalledWith("screen");
    fireEvent.click(screenFocus.getByText("Pull numbers"));
    expect(loadTodos(T)[0].subtasks![0].done).toBe(true);
    fireEvent.click(screenFocus.getByLabelText("Minimise focus"));
    expect(screen.queryByRole("dialog", { name: "Focus" })).toBeNull();
    fireEvent.click(within(screen.getByRole("region", { name: "Focusing" })).getByText("Open focus"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Focus" })).toBeNull();
    fireEvent.click(within(screen.getByRole("region", { name: "Focusing" })).getByText("Open focus"));
    at(10, 0);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Focus" })).getByText("Finish"));
    expect(await flashed("Recorded 20m on “Report”")).toBeTruthy();
    expect(loadTodos(T)[0]).toMatchObject({ completed: true, spent: 20 });
    expect(screen.queryByRole("dialog", { name: "Focus" })).toBeNull();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it("stops without finishing", async () => {
    saveTodos([todo("Report")], T);
    open();
    fireEvent.click(await tasks().findByLabelText("Focus on “Report”"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Focus" })).getByText("Stop"));
    expect(await flashed("Under a minute, so nothing was recorded")).toBeTruthy();
    expect(loadTodos(T)[0].completed).toBe(false);
  });
});

describe("swiping and arranging rows", () => {
  // Earlier than the other tests' 9:40: a swipe's "ignore the next tap" moment can't reach them.
  beforeEach(() => {
    at(8, 0);
  });
  const rowOf = (text: string) => tasks().getByText(text).closest("li")!;
  const swipe = (text: string, dx: number, pointerType?: string) => {
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 200, clientY: 100 });
    if (pointerType) Object.defineProperty(down, "pointerType", { value: pointerType });
    act(() => void rowOf(text).querySelector("button[aria-label^='Open']")!.dispatchEvent(down));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200 + dx / 2, clientY: 102 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200 + dx, clientY: 104 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointerup")));
  };

  it("swipes right to finish and left to move to tomorrow, each with undo", async () => {
    saveTodos([todo("Report", { start: 900 }), todo("Call")], T);
    open();
    await tasks().findByText("Report");
    swipe("Report", 140);
    expect(loadTodos(T).find((t) => t.id === "Report")!.completed).toBe(true);
    expect(await flashed("Done: Report")).toBeTruthy();
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(loadTodos(T).find((t) => t.id === "Report")!.completed).toBe(false));
    // The tap at the end of a swipe opens nothing, but a tap a moment later does.
    fireEvent.click(rowOf("Report").querySelector("button[aria-label^='Open']")!);
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    at(8, 1);
    fireEvent.click(rowOf("Report").querySelector("button[aria-label^='Open']")!);
    expect(screen.getByRole("dialog", { name: "Task details" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close details"));

    swipe("Call", -140);
    expect(await flashed("Moved “Call” to tomorrow")).toBeTruthy();
    expect(loadTodos("2026-11-09")[0]).toMatchObject({ text: "Call", postponed: 1 });
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(loadTodos(T).find((t) => t.id === "Call")).toEqual(todo("Call")));
    expect(loadTodos("2026-11-09")).toEqual([]);
  });

  it("ignores a short swipe, an upward drag, a mouse, and swipes from the controls", async () => {
    saveTodos([todo("Report")], T);
    open();
    await tasks().findByText("Report");
    swipe("Report", 50);
    swipe("Report", 140, "mouse");
    act(() => void rowOf("Report").querySelector("button[aria-label^='Open']")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 5, clientY: 80 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointercancel")));
    act(() => void tasks().getByLabelText("Mark “Report” done").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(loadTodos(T)[0].completed).toBe(false);
    expect(loadTodos("2026-11-09")).toEqual([]);
  });

  it("keeps a repeating task's copy on its day", async () => {
    saveTodos([todo("Daily", { dailyId: "d1" })], T);
    open();
    await tasks().findByText("Daily");
    swipe("Daily", -140);
    expect(await flashed("Repeating tasks stay on their own day")).toBeTruthy();
    // Swiping a finished task right does nothing.
    saveTodos([todo("Daily", { dailyId: "d1", completed: true })], T);
    fireEvent.click(screen.getByLabelText("Next day"));
    fireEvent.click(screen.getByLabelText("Previous day"));
    await screen.findByRole("list", { name: "Done" });
  });

  it("reorders by dragging the handle, or with the arrow keys", async () => {
    vi.stubGlobal("scrollBy", vi.fn());
    saveTodos(["alpha", "beta", "gamma"].map((id, i) => todo(id, { createdAt: `2026-11-01T00:00:0${i}.000Z` })), T);
    open();
    await tasks().findByText("alpha");
    const names = () => tasks().getAllByRole("listitem").filter((li) => li.dataset.task).map((li) => li.dataset.task);
    expect(names()).toEqual(["alpha", "beta", "gamma"]);
    names().forEach((id, i) => {
      rowOf(id!).getBoundingClientRect = () => ({ top: i * 100, height: 100, bottom: i * 100 + 100 }) as DOMRect;
    });
    act(() => void tasks().getByLabelText("Drag to reorder gamma").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 250 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: 30 })));
    expect(screen.getByTestId("drop-line")).toBeTruthy();
    act(() => void window.dispatchEvent(new MouseEvent("pointerup")));
    expect(names()).toEqual(["gamma", "alpha", "beta"]);
    act(() => void tasks().getByLabelText("Drag to reorder alpha").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 150 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: 900 })));
    expect(screen.getByTestId("drop-line")).toBeTruthy();
    act(() => void window.dispatchEvent(new MouseEvent("pointerup")));
    expect(names()).toEqual(["gamma", "beta", "alpha"]);
    fireEvent.keyDown(tasks().getByLabelText("Drag to reorder alpha"), { key: "ArrowUp" });
    expect(names()).toEqual(["gamma", "alpha", "beta"]);
    fireEvent.keyDown(tasks().getByLabelText("Drag to reorder gamma"), { key: "ArrowDown" });
    expect(names()).toEqual(["alpha", "gamma", "beta"]);
    fireEvent.keyDown(tasks().getByLabelText("Drag to reorder alpha"), { key: "ArrowUp" }); // already first
    fireEvent.keyDown(tasks().getByLabelText("Drag to reorder beta"), { key: "ArrowDown" }); // already last
    fireEvent.keyDown(tasks().getByLabelText("Drag to reorder beta"), { key: "Enter" });
    expect(names()).toEqual(["alpha", "gamma", "beta"]);
  });
});

describe("keys on today", () => {
  it("F focuses on the current task, Space finishes it, L opens the log", async () => {
    saveTodos([todo("Report", { start: 570, duration: 90 }), todo("Call", { start: 720 })], T);
    open();
    await screen.findByRole("region", { name: "Under way" });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "f" });
    expect(screen.getByRole("dialog", { name: "Focus" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "f" }); // focusing already: reopens the screen
    expect(screen.getByRole("dialog", { name: "Focus" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(document.body, { key: " " }); // finishes the session too
    expect(await flashed("Under a minute, so nothing was recorded")).toBeTruthy();
    expect(loadTodos(T).find((t) => t.id === "Report")!.completed).toBe(true);
    fireEvent.keyDown(document.body, { key: " " }); // the next one, between blocks
    expect(await flashed("Done: Call")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: " " }); // nothing left
    fireEvent.keyDown(document.body, { key: "l" });
    expect(screen.getByLabelText("Weight in kg")).toBeTruthy();
  });

  it("does nothing on another day, or from a button", async () => {
    saveTodos([todo("Report", { start: 570, duration: 90 })], T);
    open();
    await screen.findByRole("region", { name: "Under way" });
    fireEvent.keyDown(screen.getByLabelText("Next day"), { key: " " });
    expect(loadTodos(T)[0].completed).toBe(false);
    fireEvent.click(screen.getByLabelText("Next day"));
    await screen.findByText("Mon · Tomorrow");
    fireEvent.keyDown(document.body, { key: "f" });
    expect(screen.queryByRole("dialog", { name: "Focus" })).toBeNull();
  });
});

describe("the add box's options", () => {
  it("sets priority, tag, time, length, deadline and note, with the shorthand winning; priority, tag and length stay", async () => {
    open();
    fireEvent.click(await screen.findByText("More options"));
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "work" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:00" } });
    fireEvent.change(screen.getByLabelText("Length"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Bring the slides" } });
    add("Review");
    expect(loadTodos(T)[0]).toMatchObject({ text: "Review", priority: "high", tag: "work", start: 840, duration: 30, due: "2026-11-12", note: "Bring the slides" });
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe("high");
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("");
    add("Gym 6pm !low #health");
    expect(loadTodos(T)[1]).toMatchObject({ text: "Gym", priority: "low", tag: "health", start: 1080, duration: 30 });
    expect(loadTodos(T)[1].due).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "" } });
    add("Plain");
    expect(loadTodos(T)[2].priority).toBeUndefined();
  });

  it("makes a repeat, which has no deadline", async () => {
    open();
    fireEvent.click(await screen.findByText("More options"));
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2026-11-12" } });
    fireEvent.click(screen.getByText("↻ Repeat"));
    expect((screen.getByLabelText("Deadline") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "every" } });
    add("Water plants");
    const t = loadTodos(T).find((x) => x.text === "Water plants")!;
    expect(t.dailyId).toBeTruthy();
    expect(t.due).toBeUndefined();
    fireEvent.click(screen.getByText("↻ Repeat"));
    expect(screen.getByLabelText("How it repeats")).toBeTruthy();
    fireEvent.click(screen.getByText("↻ Repeat"));
    expect(screen.queryByLabelText("How it repeats")).toBeNull();
    fireEvent.click(screen.getByText("More options"));
    expect(screen.queryByLabelText("Start time")).toBeNull();
  });
});

describe("the timeline (phone)", () => {
  const show = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "timeline" }));
    const grid = screen.getByTestId("timeline-grid");
    box(grid, { top: 0 });
    return grid;
  };

  it("shows blocks, the time now and the Done column, and opens or ticks a block", async () => {
    updateDayLog(T, { wake: "06:40", drinks: [{ at: 560, ml: 250 }], water: 250 });
    saveTodos([todo("Report", { start: 570, duration: 90, tag: "work", spent: 20 }), todo("Gym", { start: 420, duration: 45, completed: true, doneAt: new Date(2026, 10, 8, 7, 50).getTime() }), todo("Short", { start: 720, duration: 15 })], T);
    open();
    await show();
    const timeline = within(screen.getByRole("region", { name: "Timeline" }));
    expect(timeline.getByLabelText("Now, 9:40 AM")).toBeTruthy();
    expect(timeline.getByText("9:30 AM – 11 AM · ⏱ 20m")).toBeTruthy();
    expect(timeline.getByText("Done")).toBeTruthy();
    expect(timeline.getAllByTestId("day-mark").map((m) => m.textContent)).toEqual(["🌅 Woke 6:40 AM", "💧 250 ml · 9:15 AM", "✓ Gym7:50 AM"]);
    expect(screen.getByRole("list", { name: "Tasks" }).closest(".hidden")).toBeTruthy(); // the list is the other view, on a phone
    fireEvent.click(timeline.getByLabelText("Mark “Report” done"));
    expect(loadTodos(T).find((t) => t.id === "Report")!.completed).toBe(true);
    fireEvent.click(timeline.getByText("Short"));
    expect(screen.getByRole("dialog", { name: "Task details" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close details"));
    fireEvent.click(screen.getByRole("button", { name: "list" }));
    expect(screen.getByRole("list", { name: "Tasks" }).closest(".hidden")).toBeNull();
  });

  it("adds a task in a tapped slot, and Escape leaves it", async () => {
    open();
    const grid = await show();
    fireEvent.click(grid, { clientY: 14.5 * 64 + 10 });
    const input = screen.getByLabelText("What's planned at 2:30 PM?");
    fireEvent.change(input, { target: { value: "Call the bank" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input); // Enter already added it
    expect(loadTodos(T)).toMatchObject([{ text: "Call the bank", start: 870, duration: 60 }]);
    fireEvent.click(grid, { clientY: 64 * 20 });
    fireEvent.keyDown(screen.getByLabelText("What's planned at 8 PM?"), { key: "Escape" });
    fireEvent.click(grid.querySelector("[data-slot]")!, { clientY: 64 * 3 });
    fireEvent.change(screen.getByLabelText("What's planned at 3 AM?"), { target: { value: "  " } });
    fireEvent.blur(screen.getByLabelText("What's planned at 3 AM?"));
    expect(loadTodos(T)).toHaveLength(1);
  });

  it("moves a block by dragging it, and changes its length by its bottom edge", async () => {
    saveTodos([todo("Report", { start: 570, duration: 60 })], T);
    open();
    const grid = await show();
    dragTo("dragOver", grid, "Report", { clientY: 64 * 13 });
    expect(within(grid).getByText("1 PM")).toBeTruthy();
    fireEvent.dragLeave(grid);
    dragTo("drop", grid, "Report", { clientY: 64 * 13 });
    expect(loadTodos(T)[0]).toMatchObject({ start: 780, duration: 60 });
    dragTo("drop", grid, "", { clientY: 64 * 2 }); // nothing being dragged
    dragTo("drop", grid, "gone", { clientY: 64 * 2 });
    expect(loadTodos(T)[0].start).toBe(780);
    const block = grid.querySelector<HTMLElement>("[data-block='Report']")!;
    const start = createEvent.dragStart(block, { dataTransfer: { setData: vi.fn() } });
    fireEvent(block, start);
    act(() => void within(block).getByTestId("resize-handle").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 100 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: 132 })));
    expect(within(block).getByText(/2:30 PM · 1h 30m/)).toBeTruthy();
    fireEvent(block, createEvent.dragStart(block, { dataTransfer: { setData: vi.fn() } })); // no drag while resizing
    act(() => void window.dispatchEvent(new MouseEvent("pointerup")));
    expect(loadTodos(T)[0]).toMatchObject({ start: 780, duration: 90 });
    fireEvent.click(block); // the click after resizing doesn't open it
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
  });
});

describe("the day bar (laptop)", () => {
  // 6 AM to midnight across 1080px: a minute a pixel, from x = 0 at 6 AM.
  const bar = async () => {
    const el = await screen.findByTestId("day-bar");
    box(el, { left: 0, width: 1080 });
    return el;
  };

  it("schedules a task dropped on it, moves blocks, and opens one", async () => {
    saveTodos([todo("Report", { start: 570, duration: 90, tag: "work" }), todo("Dentist")], T);
    open();
    const el = await bar();
    dragTo("dragOver", el, "Dentist", { clientX: 240 });
    expect(within(el).getByText("10 AM")).toBeTruthy();
    fireEvent.dragLeave(el);
    dragTo("drop", el, "Dentist", { clientX: 240 });
    expect(loadTodos(T).find((t) => t.id === "Dentist")).toMatchObject({ start: 600, duration: 60 });
    dragTo("drop", el, "", { clientX: 10 });
    fireEvent.click(el.querySelector("[data-block='Report']")!);
    expect(screen.getByRole("dialog", { name: "Task details" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close details"));
    // A task row can be dragged onto it.
    const row = tasks().getByText("Report").closest("li")!;
    const setData = vi.fn();
    fireEvent(row, createEvent.dragStart(row, { dataTransfer: { setData } }));
    expect(setData).toHaveBeenCalledWith("text/todo-id", "Report");
  });

  it("starts earlier when a block does, changes length by the right edge, and adds in a gap", async () => {
    saveTodos([todo("Early", { start: 300, duration: 30 })], T);
    open();
    const el = await bar(); // now from 5 AM: 1140 minutes over 1080px
    expect(within(el).getByText("5")).toBeTruthy();
    const block = el.querySelector<HTMLElement>("[data-block='Early']")!;
    act(() => void within(block).getByTestId("resize-edge").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 30 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60 })));
    fireEvent(block, createEvent.dragStart(block, { dataTransfer: { setData: vi.fn() } }));
    act(() => void window.dispatchEvent(new MouseEvent("pointerup")));
    expect(loadTodos(T)[0].duration).toBe(60);
    fireEvent.click(block);
    expect(screen.queryByRole("dialog", { name: "Task details" })).toBeNull();
    fireEvent.click(el, { clientX: 1080 * (15 * 60 - 300) / 1140 + 5 });
    fireEvent.change(screen.getByLabelText("What's planned at 3 PM?"), { target: { value: "Tea" } });
    fireEvent.keyDown(screen.getByLabelText("What's planned at 3 PM?"), { key: "Enter" });
    expect(loadTodos(T).find((t) => t.text === "Tea")).toMatchObject({ start: 900 });
    // A resize that ends where it started changes nothing.
    act(() => void within(el.querySelector<HTMLElement>("[data-block='Early']")!).getByTestId("resize-edge").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 30 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointercancel")));
    expect(loadTodos(T)[0].duration).toBe(60);
  });

  it("puts what was done underneath, close marks on separate rows", async () => {
    updateDayLog(T, { wake: "06:40", drinks: [{ at: 405, ml: 250 }] });
    open();
    await bar();
    const marks = within(screen.getByRole("region", { name: "Day bar" })).getAllByTestId("day-mark");
    expect(marks.map((m) => [m.textContent, m.style.top])).toEqual([
      ["🌅 Woke 6:40 AM", "0px"],
      ["💧 250 ml · 6:45 AM", "22px"],
    ]);
  });
});

describe("day tools", () => {
  it("proposes times for unscheduled tasks, lets each be changed or left out, and applies the plan", async () => {
    updateDayLog(T, { wake: "07:00", sleep: "23:00" });
    saveTodos([todo("Write", { priority: "high", duration: 60 }), todo("Read", { duration: 30 }), todo("Calls", { duration: 45 }), todo("Daily", { dailyId: "d1" })], T);
    open();
    fireEvent.click(await screen.findByText("✨ Auto-schedule"));
    const plan = within(screen.getByRole("region", { name: "Proposed schedule" }));
    expect(plan.getByText(/Proposed between 7 AM and 11 PM, most important first/)).toBeTruthy();
    expect(plan.getByText(/Left out 1 repeating task/)).toBeTruthy();
    fireEvent.change(plan.getByLabelText("Start time for “Read”"), { target: { value: "16:00" } });
    fireEvent.change(plan.getByLabelText("Start time for “Read”"), { target: { value: "" } }); // ignored
    fireEvent.change(plan.getByLabelText("Length of “Read”"), { target: { value: "45" } });
    fireEvent.click(plan.getByLabelText("Leave “Calls” out"));
    fireEvent.click(plan.getByText("Apply"));
    expect(await flashed("Scheduled 2 tasks")).toBeTruthy();
    expect(loadTodos(T).find((t) => t.id === "Read")).toMatchObject({ start: 960, duration: 45 });
    expect(loadTodos(T).find((t) => t.id === "Write")!.start).toBeDefined();
    expect(loadTodos(T).find((t) => t.id === "Calls")!.start).toBeUndefined();
    fireEvent.click(screen.getByText("✨ Auto-schedule"));
    fireEvent.click(within(screen.getByRole("region", { name: "Proposed schedule" })).getByText("Cancel"));
    expect(screen.queryByRole("region", { name: "Proposed schedule" })).toBeNull();
  });

  it("says when there's no free time, and what didn't fit", async () => {
    updateDayLog(T, { wake: "22:00", sleep: "23:00" }); // an hour free, tonight
    saveTodos([todo("Big", { duration: 240 })], T);
    open();
    fireEvent.click(await screen.findByText("✨ Auto-schedule"));
    const plan = within(screen.getByRole("region", { name: "Proposed schedule" }));
    expect(plan.getByText(/No free time between/)).toBeTruthy();
    expect(plan.getByText("Didn't fit: Big")).toBeTruthy();
    expect((plan.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a day as a template, applies it to another day, and deletes it after a second tap", async () => {
    open();
    fireEvent.click(await screen.findByText("Templates ▾"));
    const panel = () => within(screen.getByRole("region", { name: "Day templates" }));
    expect(panel().getByText(/Save a day's tasks and times as a layout/)).toBeTruthy();
    fireEvent.change(panel().getByLabelText("Template name"), { target: { value: "Workday" } });
    fireEvent.submit(panel().getByLabelText("Template name"));
    expect(await flashed("This day has no one-off tasks to save")).toBeTruthy();
    fireEvent.submit(panel().getByLabelText("Template name")); // still named: tries again
    saveTodos([todo("Standup", { start: 600, duration: 15 }), todo("Review")], T);
    fireEvent.submit(panel().getByLabelText("Template name"));
    expect(await flashed("Saved “Workday” with 2 tasks")).toBeTruthy();
    fireEvent.submit(panel().getByLabelText("Template name")); // emptied: nothing
    fireEvent.click(screen.getByLabelText("Next day"));
    fireEvent.click(await screen.findByText("Templates ▾"));
    fireEvent.click(panel().getByLabelText("Apply “Workday”"));
    expect(await flashed("Added 2 tasks from “Workday”")).toBeTruthy();
    expect(loadTodos("2026-11-09").map((t) => t.text).sort()).toEqual(["Review", "Standup"]);
    fireEvent.click(panel().getByLabelText("Apply “Workday”"));
    expect(await flashed("Everything in “Workday” is already on this day")).toBeTruthy();
    fireEvent.click(panel().getByLabelText("Delete “Workday”"));
    fireEvent.click(panel().getByText("Delete it?"));
    expect(panel().queryByText("Workday")).toBeNull();
    fireEvent.click(screen.getByText("Templates ▴"));
    expect(screen.queryByRole("region", { name: "Day templates" })).toBeNull();
  });

  it("turns reminders on, or explains why it can't, and off again", async () => {
    resetNotifications();
    open();
    const select = await screen.findByLabelText("Reminders");
    fireEvent.change(select, { target: { value: "5" } });
    expect(await flashed("This browser can't show notifications")).toBeTruthy();
    vi.stubGlobal("Notification", FakeNotification);
    FakeNotification.permission = "denied";
    fireEvent.change(select, { target: { value: "5" } });
    expect(await flashed("Notifications are blocked for this site")).toBeTruthy();
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockResolvedValueOnce("granted");
    fireEvent.change(select, { target: { value: "10" } });
    expect(await flashed("Reminders on while this page is open")).toBeTruthy();
    expect(localStorage.getItem("reel-radar-reminder-lead")).toBe("10");
    expect((select as HTMLSelectElement).value).toBe("10");
    fireEvent.change(select, { target: { value: "" } });
    expect(localStorage.getItem("reel-radar-reminder-lead")).toBeNull();
  });

  it("reminds about a block coming up while the page is open, once", async () => {
    resetNotifications();
    vi.stubGlobal("Notification", FakeNotification);
    localStorage.setItem("reel-radar-reminder-lead", "5");
    saveTodos([todo("Meeting", { start: 583, duration: 30 })], T);
    open();
    await waitFor(() => expect(FakeNotification.sent.map((n) => n.title)).toEqual(["Meeting"]));
    fireEvent.click(screen.getByLabelText("Next day"));
    fireEvent.click(screen.getByLabelText("Previous day"));
    await tasks().findByText("Meeting");
    expect(FakeNotification.sent).toHaveLength(1);
  });

  it("says once when a focus session's planned time is up", async () => {
    resetNotifications();
    vi.stubGlobal("Notification", FakeNotification);
    saveTodos([todo("Sprint", { start: 570, duration: 15, spent: 20 })], T);
    open();
    fireEvent.click(await tasks().findByLabelText("Focus on “Sprint”"));
    await waitFor(() => expect(FakeNotification.sent).toEqual([{ title: "Time's up: Sprint", body: "Your planned time for this block is over." }]));
    expect(screen.getByTestId("focus-big-clock").textContent).toMatch(/^\+5:00$/);
  });
});

describe("filtering the list", () => {
  it("shows all, open or done tasks, by words and by tag, and offers to search every day", async () => {
    saveTodos([todo("Report", { tag: "work", note: "quarterly numbers" }), todo("Laundry", { tag: "home" }), todo("Gym", { completed: true })], T);
    open();
    await tasks().findByText("Report");
    const names = () => [...(screen.queryByRole("list", { name: "Tasks" })?.querySelectorAll("li[data-task]") ?? []), ...(screen.queryByRole("list", { name: "Done" })?.querySelectorAll("li[data-task]") ?? [])].map((li) => (li as HTMLElement).dataset.task);
    fireEvent.click(screen.getByRole("button", { name: "active (2)" }));
    expect(names()).toEqual(["Report", "Laundry"]);
    fireEvent.click(screen.getByRole("button", { name: "done (1)" }));
    expect(names()).toEqual(["Gym"]);
    fireEvent.click(screen.getByRole("button", { name: "all" }));
    fireEvent.change(screen.getByLabelText("Filter this day"), { target: { value: "QUARTERLY" } });
    expect(names()).toEqual(["Report"]);
    fireEvent.change(screen.getByLabelText("Filter this day"), { target: { value: "dentist" } });
    expect(screen.getByText("No tasks match this filter.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search every day →" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter this day"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(names()).toEqual(["Laundry"]);
    // The chosen tag stays offered on a day without it.
    fireEvent.click(screen.getByLabelText("Next day"));
    saveTodos([todo("Other", { tag: "work" })], "2026-11-09");
    fireEvent.click(screen.getByLabelText("Previous day"));
    fireEvent.click(screen.getByLabelText("Next day"));
    await waitFor(() => expect(screen.getByText("No tasks match this filter.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Search every day →" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All tags" }));
    expect(names()).toEqual(["Other"]);
  });

  it("when everything's done, offers to plan the next day", async () => {
    saveTodos([todo("Gym", { completed: true })], T);
    open();
    fireEvent.click(await screen.findByText("Plan tomorrow →"));
    expect(await screen.findByText("Mon · Tomorrow")).toBeTruthy();
  });
});
