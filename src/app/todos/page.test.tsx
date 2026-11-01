// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsonResponse } from "@/test/fixtures";
import { requests, routeFetch } from "@/test/pages";
import { weekStart } from "@/lib/plannerStats";
import { Todo, addTodo, getTodayDate, loadDayLog, loadDailyTasks, loadTodos, saveTodos, shiftDate } from "@/lib/todos";

vi.mock("next/navigation", () => ({ usePathname: () => "/todos" }));

import TodosPage from "./page";

const T = getTodayDate();
const Y = shiftDate(T, -1);
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: `2026-01-01T00:00:0${id.length % 10}.000Z`,
  ...extra,
});
const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// A task's row in the list (its title is a <p>; the planner shows it in a <span>).
const item = (text: string) => screen.getByText(text, { selector: "p" }).closest("div[draggable]") as HTMLElement;
const inItem = (text: string) => within(item(text));
const grid = (container: HTMLElement) => container.querySelector<HTMLElement>("[style*='height: 1536px']")!;
const flashed = (text: string | RegExp) => screen.findByText(text);

// jsdom has no DragEvent; set what the drop handler reads on a generic event.
const drag = (kind: "dragOver" | "drop", el: HTMLElement, id: string, clientY: number) => {
  const event = createEvent[kind](el, { dataTransfer: { getData: (k: string) => (k === "text/todo-id" ? id : ""), dropEffect: "" } });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(el, event);
};

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static sent: { title: string; body?: string }[] = [];
  constructor(title: string, opts?: { body?: string }) {
    FakeNotification.sent.push({ title, body: opts?.body });
  }
}

let fetch: ReturnType<typeof routeFetch>;
beforeEach(() => {
  fetch = routeFetch();
  Element.prototype.scrollTo = vi.fn();
  FakeNotification.permission = "granted";
  FakeNotification.sent = [];
});

describe("arranging tasks", () => {
  const rows = () => screen.getAllByText(/^(alpha|beta|gamma|daily)$/, { selector: "p" }).map((p) => p.textContent);
  const aged = (id: string, n: number, extra: Partial<Todo> = {}) => todo(id, { createdAt: `2026-01-01T00:00:0${n}.000Z`, ...extra });
  const handle = (text: string) => screen.getByLabelText(`Drag to reorder ${text}`);
  const move = (y: number) => act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: y })));
  const release = (type = "pointerup") => act(() => void window.dispatchEvent(new MouseEvent(type)));
  // jsdom has no layout: give the rows 100px-tall boxes, one under the other, in the order they are shown.
  const layout = () =>
    rows().forEach((text, i) => {
      item(text!).getBoundingClientRect = () => ({ top: i * 100, height: 100, bottom: i * 100 + 100 }) as DOMRect;
    });
  const grab = (text: string, y = 0) => {
    layout();
    act(() => void handle(text).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: y })));
  };

  beforeEach(() => {
    vi.stubGlobal("scrollBy", vi.fn()); // jsdom doesn't implement it
    saveTodos([aged("alpha", 1), aged("beta", 2), aged("gamma", 3), aged("daily", 4, { dailyId: "d1" })], T);
  });

  it("shows daily tasks first, then drops a dragged task where the line shows", () => {
    render(<TodosPage />);
    expect(rows()).toEqual(["daily", "alpha", "beta", "gamma"]);
    grab("gamma", 350);
    move(30); // above the middle of the first row
    expect(screen.getByTestId("drop-line")).toBeTruthy();
    expect(item("gamma").style.transform).toBe("translateY(-320px)");
    release();
    expect(screen.queryByTestId("drop-line")).toBeNull();
    expect(rows()).toEqual(["gamma", "daily", "alpha", "beta"]);
    expect(loadTodos(T).map((x) => x.order)).not.toContain(undefined);
  });

  it("drops at the end of the unfinished tasks when dragged below the last one", () => {
    render(<TodosPage />);
    grab("daily", 50);
    move(900);
    expect(screen.getByTestId("drop-line")).toBeTruthy();
    release();
    expect(rows()).toEqual(["alpha", "beta", "gamma", "daily"]);
  });

  it("changes nothing when the task is let go without moving or the drag is cancelled", () => {
    render(<TodosPage />);
    grab("alpha", 150);
    release();
    grab("gamma", 350);
    move(10);
    release("pointercancel");
    expect(rows()).toEqual(["daily", "alpha", "beta", "gamma"]);
    expect(loadTodos(T).every((x) => x.order === undefined)).toBe(true);
  });

  it("scrolls the page when dragging near the top or bottom edge", () => {
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    render(<TodosPage />);
    grab("beta", 250);
    move(20);
    move(window.innerHeight - 10);
    release();
    expect(scrollBy).toHaveBeenCalledWith(0, -14);
    expect(scrollBy).toHaveBeenCalledWith(0, 14);
  });

  it("only lets unfinished tasks be dragged, and ignores the right mouse button", () => {
    saveTodos([aged("alpha", 1), aged("gamma", 3, { completed: true })], T);
    render(<TodosPage />);
    expect(screen.queryByLabelText("Drag to reorder gamma")).toBeNull();
    layout();
    act(() => void handle("alpha").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2, clientY: 0 })));
    move(500);
    release();
    expect(loadTodos(T).every((x) => x.order === undefined)).toBe(true);
  });

  it("moves a task with the arrow keys, and stops at the ends", () => {
    render(<TodosPage />);
    fireEvent.keyDown(handle("beta"), { key: "ArrowUp" });
    expect(rows()).toEqual(["daily", "beta", "alpha", "gamma"]);
    fireEvent.keyDown(handle("beta"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("beta"), { key: "ArrowDown" });
    expect(rows()).toEqual(["daily", "alpha", "gamma", "beta"]);
    fireEvent.keyDown(handle("beta"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("daily"), { key: "ArrowUp" });
    fireEvent.keyDown(handle("daily"), { key: "Enter" });
    expect(rows()).toEqual(["daily", "alpha", "gamma", "beta"]);
  });
});

describe("day log", () => {
  // Pick a time on the clock face: hour, then minute, then AM/PM, then Done.
  const setClock = (label: string, hour: number, minute: number, period: "AM" | "PM") => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
    fireEvent.click(screen.getByLabelText(`${hour} o'clock`));
    fireEvent.click(screen.getByLabelText(`${minute} minutes`));
    const clock = within(screen.getByRole("dialog"));
    fireEvent.click(clock.getByText(period));
    fireEvent.click(clock.getByText("Done"));
  };

  it("records wake time, sleep time and water for the day shown", async () => {
    render(<TodosPage />);
    expect(screen.getAllByText("Set time")).toHaveLength(2);
    setClock("Woke up", 6, 45, "AM");
    setClock("Went to sleep", 11, 15, "PM");
    expect(screen.getByRole("button", { name: "Woke up: 6:45 AM" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("More water"));
    fireEvent.click(screen.getByLabelText("More water"));
    fireEvent.click(screen.getByLabelText("More water"));
    fireEvent.click(screen.getByLabelText("Less water"));
    fireEvent.click(screen.getByLabelText("Add a bottle"));
    expect(screen.getByTestId("water-total").textContent).toBe("1 L");
    expect(loadDayLog(T)).toEqual({ wake: "06:45", sleep: "23:15", water: 1000 });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1000");
    // Clearing a time removes it.
    fireEvent.click(screen.getByRole("button", { name: /^Woke up:/ }));
    fireEvent.click(screen.getByText("Clear"));
    expect(loadDayLog(T)).toEqual({ sleep: "23:15", water: 1000 });
    // The notes stay closed until asked for, and keep what you type.
    expect(screen.queryByLabelText("What went well")).toBeNull();
    fireEvent.click(screen.getByText("How did the day go?"));
    fireEvent.change(screen.getByLabelText("What went well"), { target: { value: "Shipped it" } });
    fireEvent.change(screen.getByLabelText("What went badly"), { target: { value: "Skipped lunch" } });
    fireEvent.change(screen.getByLabelText("What to improve"), { target: { value: "Plan breaks" } });
    expect(loadDayLog(T)).toEqual({ sleep: "23:15", water: 1000, well: "Shipped it", bad: "Skipped lunch", improve: "Plan breaks" });
    fireEvent.click(screen.getByText("How did the day go?"));
    expect(screen.queryByLabelText("What went well")).toBeNull();
    expect(screen.getByLabelText("has notes")).toBeTruthy();
    // Another day has its own log.
    fireEvent.click(screen.getByLabelText("Previous day"));
    await waitFor(() => expect(screen.getAllByText("Set time")).toHaveLength(2));
    expect(screen.getByTestId("water-total").textContent).toBe("0 L");
    expect(screen.queryByLabelText("has notes")).toBeNull();
  });

  it("records and clears body weight for the day shown", async () => {
    render(<TodosPage />);
    const input = screen.getByLabelText("Weight in kg") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "72.5" } });
    expect(loadDayLog(T)).toEqual({ weight: 72.5 });
    fireEvent.change(input, { target: { value: "" } });
    expect(loadDayLog(T)).toEqual({});
    fireEvent.change(input, { target: { value: "71" } });
    fireEvent.click(screen.getByLabelText("Previous day"));
    await waitFor(() => expect((screen.getByLabelText("Weight in kg") as HTMLInputElement).value).toBe(""));
  });

  it("opens a day that already has notes with them showing, and caps the goal bar", () => {
    localStorage.setItem(
      "reel-radar-planner-log",
      JSON.stringify({ items: [{ date: T, updatedAt: 1, log: { improve: "Sleep earlier", water: 3000 } }] })
    );
    render(<TodosPage />);
    expect((screen.getByLabelText("What to improve") as HTMLTextAreaElement).value).toBe("Sleep earlier");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2500");
  });
});

describe("friendlier planner", () => {
  const input = () => screen.getByPlaceholderText("What needs to be done today?") as HTMLInputElement;

  it("adds a task from shorthand, showing what it understood first", () => {
    render(<TodosPage />);
    expect(screen.getByText(/Shorthand:/)).toBeTruthy();
    fireEvent.change(input(), { target: { value: "Gym 6:30pm 45m #health !high daily" } });
    const preview = within(screen.getByTestId("quick-add-preview"));
    expect(preview.getByText("⏰ 6:30 PM · 45m")).toBeTruthy();
    expect(preview.getByText("⚑ High")).toBeTruthy();
    expect(preview.getByText("# Health")).toBeTruthy();
    expect(preview.getByText("↻ Every day")).toBeTruthy();
    expect(preview.getByText("→ “Gym”")).toBeTruthy();
    fireEvent.click(screen.getByText("Add"));
    expect(loadTodos(T)[0]).toMatchObject({ text: "Gym", start: 1110, duration: 45, tag: "health", priority: "high" });
    expect(loadDailyTasks()[0]).toMatchObject({ text: "Gym" });
  });

  it("warns that a length needs a time, and keeps a title made only of shorthand", () => {
    render(<TodosPage />);
    fireEvent.change(input(), { target: { value: "Read 30m" } });
    expect(screen.getByText("⏱ 30m (add a time to schedule it)")).toBeTruthy();
    fireEvent.change(input(), { target: { value: "Plain words" } });
    expect(screen.queryByTestId("quick-add-preview")).toBeNull();
    expect(screen.queryByText(/Shorthand:/)).toBeNull();
    fireEvent.change(input(), { target: { value: "!high" } });
    fireEvent.click(screen.getByText("Add"));
    expect(loadTodos(T)[0]).toMatchObject({ text: "!high", priority: "high" });
  });

  it("shows progress in the ring and an encouraging line", () => {
    saveTodos([todo("a", { completed: true }), todo("bb"), todo("ccc")], T);
    render(<TodosPage />);
    expect(screen.getByRole("img", { name: "33% done" })).toBeTruthy();
    expect(screen.getByText("Good start. 2 to go, one at a time.")).toBeTruthy();
    fireEvent.click(inItem("bb").getByLabelText("Mark as complete"));
    expect(screen.getByText("Over halfway there. 1 to go.")).toBeTruthy();
  });

  it("celebrates a finished day and offers to plan the next one", async () => {
    saveTodos([todo("a", { completed: true })], T);
    render(<TodosPage />);
    expect(screen.getByText("All done for Today 🎉")).toBeTruthy();
    expect(screen.getByText("Everything's done. Nicely handled.")).toBeTruthy();
    fireEvent.click(screen.getByText("Plan tomorrow →"));
    await waitFor(() => expect(screen.getByText("Nothing planned for Tomorrow")).toBeTruthy());
    expect(screen.getByText("A blank page. What matters most today?")).toBeTruthy();
  });

  it("opens a day from the week strip, which shows how each day went", async () => {
    const monday = weekStart(T);
    const other = monday === T ? shiftDate(T, 1) : monday; // another day in this week
    saveTodos([todo("w1", { completed: true }), todo("w2")], other);
    render(<TodosPage />);
    expect(screen.getByRole("button", { current: "date" }).getAttribute("aria-label")).toMatch(/nothing planned$/);
    fireEvent.click(screen.getByLabelText(/: 1 of 2 done$/));
    expect(await screen.findByText("w2", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { current: "date" }).getAttribute("aria-label")).toMatch(/1 of 2 done$/);
  });

  it("has keyboard shortcuts for adding, changing day, today and the week view", async () => {
    render(<TodosPage />);
    input().blur();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("Nothing planned for Tomorrow")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(await screen.findByText("Nothing planned for Yesterday")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "t" });
    expect(await screen.findByText("Nothing planned for Today")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "w" });
    expect(screen.getByText("This week at a glance")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.keyDown(document.body, { key: "n" });
    await waitFor(() => expect(document.activeElement).toBe(input()));
    // Typing in a field or holding a modifier doesn't trigger them.
    fireEvent.keyDown(input(), { key: "t" });
    fireEvent.keyDown(document.body, { key: "ArrowRight", ctrlKey: true });
    expect(screen.getByText("Nothing planned for Today")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.keyDown(document.body, { key: "x" });
  });
});

describe("adding tasks", () => {
  it("adds a task with priority, tag, time, length, note and repeat days, then resets the form", async () => {
    render(<TodosPage />);
    expect(screen.getByText("Nothing planned for Today")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Write report" } });
    fireEvent.change(screen.getAllByLabelText("Priority")[0], { target: { value: "high" } });
    fireEvent.change(screen.getAllByLabelText("Tag")[0], { target: { value: "work" } });
    fireEvent.change(screen.getByLabelText("Start time (optional)"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "90" } });
    fireEvent.click(screen.getByTitle("Add a description"));
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), { target: { value: "Q3 numbers" } });
    fireEvent.click(screen.getByTitle("Repeat this task every day"));
    fireEvent.click(screen.getByLabelText("Sun"));
    fireEvent.click(screen.getByLabelText("Sat"));
    expect(screen.getByTitle("Repeat this task every day").textContent).toBe("↻ Weekdays");
    fireEvent.click(screen.getByText("Add"));

    const [t] = loadTodos(T);
    expect(t).toMatchObject({ text: "Write report", priority: "high", tag: "work", start: 570, duration: 90, note: "Q3 numbers" });
    expect(loadDailyTasks()[0]).toMatchObject({ text: "Write report", days: [1, 2, 3, 4, 5] });
    expect((screen.getByPlaceholderText("What needs to be done today?") as HTMLInputElement).value).toBe("");
    expect(screen.queryByPlaceholderText("Description (optional)")).toBeNull();
    expect(screen.getByText("Q3 numbers")).toBeTruthy();
    expect(inItem("Write report").getByText("↻ Weekdays")).toBeTruthy();
  });

  it("submits from the note with Ctrl+Enter, and ignores a blank title", () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByText("Add")); // disabled while blank
    fireEvent.submit(screen.getByText("Add").closest("form")!);
    expect(loadTodos(T)).toEqual([]);
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Call" } });
    fireEvent.click(screen.getByTitle("Add a description"));
    fireEvent.keyDown(screen.getByPlaceholderText("Description (optional)"), { key: "Enter" });
    expect(loadTodos(T)).toEqual([]);
    fireEvent.keyDown(screen.getByPlaceholderText("Description (optional)"), { key: "Enter", ctrlKey: true });
    expect(loadTodos(T).map((t) => t.text)).toEqual(["Call"]);
  });
});

describe("the task list", () => {
  beforeEach(() => {
    saveTodos(
      [
        todo("Low", { priority: "low", tag: "home" }),
        todo("Done", { completed: true, tag: "work" }),
        todo("Urgent", { priority: "high", note: "before noon" }),
      ],
      T
    );
  });

  it("sorts by state and priority, and filters by state, search and tag", () => {
    render(<TodosPage />);
    const rows = () => screen.getAllByText(/^(Low|Done|Urgent)$/, { selector: "p" }).map((p) => p.textContent);
    expect(rows()).toEqual(["Urgent", "Low", "Done"]);
    expect(screen.getByText("1/3")).toBeTruthy();
    fireEvent.click(screen.getByText("active (2)"));
    expect(rows()).toEqual(["Urgent", "Low"]);
    fireEvent.click(screen.getByText("done (1)"));
    expect(rows()).toEqual(["Done"]);
    fireEvent.click(screen.getByText("all"));
    fireEvent.change(screen.getByPlaceholderText("Search tasks"), { target: { value: "noon" } });
    expect(rows()).toEqual(["Urgent"]); // matches the note
    fireEvent.change(screen.getByPlaceholderText("Search tasks"), { target: { value: "zzz" } });
    expect(screen.getByText("No tasks match this filter.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search tasks"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Home", { selector: "button" }));
    expect(rows()).toEqual(["Low"]);
    fireEvent.click(screen.getByText("All tags"));
    expect(rows()).toHaveLength(3);
  });

  it("toggles, cycles priority, tags, and clears completed", () => {
    render(<TodosPage />);
    fireEvent.click(inItem("Low").getByLabelText("Mark as complete"));
    expect(loadTodos(T).find((t) => t.id === "Low")!.completed).toBe(true);
    fireEvent.click(inItem("Low").getByLabelText("Mark as incomplete"));

    const cycle = () => fireEvent.click(inItem("Urgent").getByLabelText("Change priority"));
    const priority = () => loadTodos(T).find((t) => t.id === "Urgent")!.priority;
    cycle();
    expect(priority()).toBe("medium");
    cycle();
    expect(priority()).toBe("low");
    cycle();
    expect(priority()).toBeUndefined();
    cycle();
    expect(priority()).toBe("high");

    fireEvent.change(inItem("Urgent").getByLabelText("Tag"), { target: { value: "health" } });
    expect(loadTodos(T).find((t) => t.id === "Urgent")!.tag).toBe("health");
    fireEvent.change(inItem("Urgent").getByLabelText("Tag"), { target: { value: "" } });
    expect(loadTodos(T).find((t) => t.id === "Urgent")!.tag).toBeUndefined();

    fireEvent.click(screen.getByText("Clear completed"));
    expect(loadTodos(T).map((t) => t.id).sort()).toEqual(["Low", "Urgent"]);
    expect(screen.getByText("2 items left")).toBeTruthy();
  });

  it("edits a title and note, cancels with Escape, and deletes an emptied task", () => {
    // The add form's note box is closed, so this is the editor's.
    const editNote = () => screen.getByPlaceholderText("Description (optional)");
    render(<TodosPage />);
    fireEvent.doubleClick(screen.getByText("Urgent", { selector: "p" }));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "Very urgent" } });
    fireEvent.change(editNote(), { target: { value: "" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Title"), { key: "Enter" });
    expect(loadTodos(T).find((t) => t.id === "Urgent")).toMatchObject({ text: "Very urgent" });
    expect(loadTodos(T).find((t) => t.id === "Urgent")!.note).toBeUndefined();

    fireEvent.click(inItem("Low").getByLabelText("Edit todo"));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "changed" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Title"), { key: "Escape" });
    expect(screen.getByText("Low", { selector: "p" })).toBeTruthy();

    fireEvent.doubleClick(screen.getByText("Low", { selector: "p" }));
    fireEvent.change(editNote(), { target: { value: "n" } });
    fireEvent.keyDown(editNote(), { key: "Enter", ctrlKey: true });
    expect(loadTodos(T).find((t) => t.id === "Low")!.note).toBe("n");

    fireEvent.doubleClick(screen.getByText("n", { selector: "p" }));
    fireEvent.keyDown(editNote(), { key: "Escape" });
    fireEvent.doubleClick(screen.getByText("Low", { selector: "p" }));
    fireEvent.change(screen.getByPlaceholderText("Title"), { target: { value: "  " } });
    fireEvent.blur(screen.getByPlaceholderText("Title"));
    expect(loadTodos(T).some((t) => t.id === "Low")).toBe(false);
  });

  it("deletes with an undo", async () => {
    render(<TodosPage />);
    fireEvent.click(inItem("Low").getByLabelText("Delete todo"));
    expect(screen.queryByText("Low", { selector: "p" })).toBeNull();
    fireEvent.click(screen.getByText("Undo"));
    expect(screen.getByText("Low", { selector: "p" })).toBeTruthy();
    expect(loadTodos(T)).toHaveLength(3);
  });

  it("keeps a checklist", () => {
    render(<TodosPage />);
    fireEvent.click(inItem("Low").getByText("+ Checklist"));
    const input = () => screen.getByPlaceholderText("Add an item, Enter for the next");
    fireEvent.change(input(), { target: { value: "Milk" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "Eggs" } });
    fireEvent.blur(input());
    expect(inItem("Low").getByText("☑ 0/2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Mark "Milk" as done'));
    expect(inItem("Low").getByText("☑ 1/2")).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Mark "Milk" as not done'));
    fireEvent.click(screen.getByLabelText('Delete "Eggs"'));
    fireEvent.click(inItem("Low").getByText("+ Add item"));
    fireEvent.change(input(), { target: { value: "dropped" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(loadTodos(T).find((t) => t.id === "Low")!.subtasks!.map((s) => s.text)).toEqual(["Milk"]);
  });

  it("shows time spent, carried-over origin and a streak", async () => {
    saveTodos([todo("Timed", { start: 600, spent: 30, carriedFrom: Y })], T);
    const daily = addTodo("Habit", shiftDate(T, -3), undefined, undefined, true)[0].dailyId!;
    // Each earlier day's copy, done.
    for (let i = 3; i >= 1; i--) {
      const d = shiftDate(T, -i);
      saveTodos([{ ...todo(`${daily}:${d}`, { text: "Habit" }), dailyId: daily, completed: true }], d);
    }
    render(<TodosPage />);
    await screen.findByText("Habit", { selector: "p" }); // today's copy, added after the sync
    expect(inItem("Timed").getByText("⏱ 30m / 1h")).toBeTruthy();
    expect(inItem("Timed").getByText("from Yesterday")).toBeTruthy();
    expect(inItem("Habit").getByText("🔥 3")).toBeTruthy();
  });
});

describe("repeating tasks", () => {
  it("makes a task repeat, picks its days, and stops it", async () => {
    saveTodos([todo("Run")], T);
    render(<TodosPage />);
    fireEvent.click(inItem("Run").getByLabelText("Repeat daily"));
    expect(await flashed("Repeats every day from now on")).toBeTruthy();
    fireEvent.click(inItem("Run").getByText("↻ Daily"));
    fireEvent.click(inItem("Run").getByLabelText("Sun"));
    fireEvent.click(inItem("Run").getByLabelText("Sat"));
    expect(loadDailyTasks()[0].days).toEqual([1, 2, 3, 4, 5]);
    expect(inItem("Run").getByText("↻ Weekdays")).toBeTruthy();
    for (const d of ["Mon", "Tue", "Wed", "Thu"]) fireEvent.click(inItem("Run").getByLabelText(d));
    fireEvent.click(inItem("Run").getByLabelText("Fri")); // the last day stays on
    expect(loadDailyTasks()[0].days).toEqual([5]);
    expect(inItem("Run").getByText("↻ Fri")).toBeTruthy();
    fireEvent.click(inItem("Run").getByLabelText("Sat"));
    fireEvent.click(inItem("Run").getByLabelText("Sun"));
    fireEvent.click(inItem("Run").getByLabelText("Fri"));
    expect(inItem("Run").getByText("↻ Weekends")).toBeTruthy();
    fireEvent.click(inItem("Run").getByText("Stop repeating"));
    expect(await flashed("No longer repeats daily")).toBeTruthy();
    expect(loadDailyTasks()).toEqual([]);
  });

  it("restores a deleted daily copy with undo", () => {
    addTodo("Stretch", T, undefined, undefined, true);
    render(<TodosPage />);
    fireEvent.click(inItem("Stretch").getByLabelText("Delete todo"));
    fireEvent.click(screen.getByText("Undo"));
    expect(loadTodos(T).map((t) => t.text)).toEqual(["Stretch"]);
  });
});

describe("the schedule", () => {
  it("schedules from the list and edits the selected block", async () => {
    saveTodos([todo("Read", { note: "chapter 3" })], T);
    render(<TodosPage />);
    fireEvent.click(inItem("Read").getByText("+ Schedule"));
    expect(await flashed(/^Scheduled at /)).toBeTruthy();
    expect(loadTodos(T)[0].start).toBeDefined();

    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:00" } });
    expect(loadTodos(T)[0].start).toBe(840);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } }); // ignored
    fireEvent.change(screen.getAllByLabelText("Duration").at(-1)!, { target: { value: "30" } });
    expect(loadTodos(T)[0]).toMatchObject({ start: 840, duration: 30 });
    expect(screen.getByText("chapter 3", { selector: "p.w-full" })).toBeTruthy();
    fireEvent.click(screen.getByText("Mark done"));
    fireEvent.click(screen.getByText("Mark not done"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByText("Remove from schedule")).toBeNull();

    fireEvent.click(inItem("Read").getByTitle("Show in schedule"));
    expect(screen.getByText("Remove from schedule")).toBeTruthy();
    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Remove from schedule"));
    expect(loadTodos(T)[0].start).toBeUndefined();
  });

  it("schedules a task on another day at 9 AM", () => {
    const tomorrow = shiftDate(T, 1);
    saveTodos([todo("Plan")], tomorrow);
    render(<TodosPage />);
    fireEvent.click(screen.getByLabelText("Next day"));
    fireEvent.click(inItem("Plan").getByText("+ Schedule"));
    expect(loadTodos(tomorrow)[0].start).toBe(540);
  });

  it("selects a block, toggles it, and opens a quick-add slot from the grid", () => {
    saveTodos([todo("Block", { start: 600 })], T);
    const { container } = render(<TodosPage />);
    fireEvent.click(screen.getByText("Block", { selector: "span" }));
    expect(screen.getByText("Remove from schedule")).toBeTruthy();
    fireEvent.click(within(grid(container)).getByLabelText("Mark as complete"));
    expect(loadTodos(T)[0].completed).toBe(true);

    fireEvent.click(grid(container), { clientY: 14 * 64 + 10 }); // 2 PM
    const quick = screen.getByPlaceholderText("2 PM - what's planned?");
    expect(screen.queryByText("Remove from schedule")).toBeNull();
    fireEvent.change(quick, { target: { value: "Standup" } });
    fireEvent.keyDown(quick, { key: "Enter" });
    fireEvent.blur(quick); // Enter already saved; the blur mustn't save twice
    expect(loadTodos(T).filter((t) => t.text === "Standup")).toEqual([expect.objectContaining({ start: 840, duration: 60 })]);

    fireEvent.click(grid(container), { clientY: 64 });
    fireEvent.keyDown(screen.getByPlaceholderText("1 AM - what's planned?"), { key: "Escape" });
    expect(screen.queryByPlaceholderText("1 AM - what's planned?")).toBeNull();
    fireEvent.click(grid(container), { clientY: 3 * 64 });
    fireEvent.change(screen.getByPlaceholderText("3 AM - what's planned?"), { target: { value: "Blurred" } });
    fireEvent.blur(screen.getByPlaceholderText("3 AM - what's planned?"));
    expect(loadTodos(T).some((t) => t.text === "Blurred" && t.start === 180)).toBe(true);
    fireEvent.click(grid(container), { clientY: 5 * 64 });
    fireEvent.blur(screen.getByPlaceholderText("5 AM - what's planned?")); // empty: nothing added
    expect(loadTodos(T)).toHaveLength(3);
  });

  it("places a task dropped onto the grid", () => {
    saveTodos([todo("Drop me")], T);
    const { container } = render(<TodosPage />);
    drag("dragOver", grid(container), "Drop me", 10 * 64);
    expect(screen.getByText("10 AM", { selector: "span.rounded" })).toBeTruthy();
    fireEvent.dragLeave(grid(container));
    drag("drop", grid(container), "Drop me", 23.9 * 64); // clamped to fit the hour
    expect(loadTodos(T)[0]).toMatchObject({ start: 1380, duration: 60 });
    drag("drop", grid(container), "", 0); // nothing carried
    drag("drop", grid(container), "missing", 0);

    const data: Record<string, string> = {};
    fireEvent.dragStart(item("Drop me"), { dataTransfer: { setData: (k: string, v: string) => (data[k] = v) } });
    expect(data["text/todo-id"]).toBe("Drop me");
  });

  it("resizes a block in the day view", () => {
    saveTodos([todo("Grow", { start: 600 })], T);
    render(<TodosPage />);
    const handle = screen.getByTitle("Drag to change length");
    act(() => void handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 0 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: 64 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointerup", { clientY: 64 })));
    expect(loadTodos(T)[0].duration).toBe(120);
  });

  it("switches between tasks and schedule on phones", () => {
    saveTodos([todo("A", { start: 60 })], T);
    render(<TodosPage />);
    fireEvent.click(screen.getByText("schedule (1)"));
    expect(screen.getByText("Schedule").closest("section")!.className).not.toContain("hidden lg:block");
    fireEvent.click(screen.getByText("tasks (1)"));
  });
});

describe("days", () => {
  it("navigates by day, date picker and week, and opens a day from the week view", () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByLabelText("Previous day"));
    expect(screen.getByText(/^Yesterday ·/)).toBeTruthy();
    fireEvent.click(screen.getByText("Today"));
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(screen.getByText(/^Tomorrow ·/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: "2026-03-02" } });
    expect(screen.getByText("Mon, Mar 2, 2026 · Mon, Mar 2, 2026")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: "" } }); // ignored

    fireEvent.click(screen.getByText("week"));
    expect(screen.getByText("Week of Mar 2 – Mar 8")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(screen.getByText("Week of Mar 9 – Mar 15")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous week"));
    fireEvent.click(screen.getByTitle(/^Open Wed, Mar 4/));
    expect(screen.getByText("Wed, Mar 4, 2026 · Wed, Mar 4, 2026")).toBeTruthy();
    fireEvent.click(screen.getByText("week"));
    fireEvent.click(screen.getByText("day"));
  });

  it("brings over yesterday's unfinished tasks, one or all", async () => {
    saveTodos([todo("Left"), todo("Also", { priority: "high" }), todo("Finished", { completed: true })], Y);
    render(<TodosPage />);
    await screen.findByText("2 unfinished tasks from Yesterday");
    fireEvent.click(screen.getByText("Choose"));
    fireEvent.click(screen.getAllByText("+ Add")[0]); // "Also" sorts first (high priority)
    expect(await flashed("Added 1 task from Yesterday")).toBeTruthy();
    expect(loadTodos(T).map((t) => t.id)).toEqual(["Also"]);
    fireEvent.click(screen.getByText("Add all"));
    expect(loadTodos(T).map((t) => t.id)).toEqual(["Also", "Left"]);
    expect(screen.queryByText(/unfinished task/)).toBeNull();
  });

  it("toggles the carry-over list from its summary", async () => {
    saveTodos([todo("Left")], Y);
    render(<TodosPage />);
    fireEvent.click(await screen.findByText("1 unfinished task from Yesterday"));
    expect(screen.getByText("Hide")).toBeTruthy();
    fireEvent.click(screen.getByText("Hide"));
    expect(screen.getByText("Choose")).toBeTruthy();
  });

  it("lists other days and opens one", () => {
    saveTodos([todo("Past", { completed: true }), todo("Open")], "2026-02-01");
    render(<TodosPage />);
    fireEvent.click(screen.getByText("1/2 done").closest("button")!);
    expect(screen.getByText("Past", { selector: "p" })).toBeTruthy();
  });

  it("moves or copies a task to another day", async () => {
    const tomorrow = shiftDate(T, 1);
    saveTodos([todo("Errand", { start: 600 }), todo("Copy me")], T);
    render(<TodosPage />);
    fireEvent.click(inItem("Errand").getByLabelText("Move or copy to another day"));
    expect(screen.getByText("Keeps the 10 AM time slot")).toBeTruthy();
    expect((screen.getByLabelText("Day to move or copy to") as HTMLInputElement).value).toBe(tomorrow);
    fireEvent.click(screen.getByText("Move"));
    expect(await flashed("Moved to Tomorrow")).toBeTruthy();
    expect(loadTodos(tomorrow)[0]).toMatchObject({ id: "Errand", start: 600 });
    expect(requests(fetch, "/api/sync").length).toBeGreaterThan(0); // pulled the target day first

    fireEvent.click(inItem("Copy me").getByLabelText("Move or copy to another day"));
    fireEvent.change(screen.getByLabelText("Day to move or copy to"), { target: { value: "2026-12-25" } });
    fireEvent.click(screen.getByText("Copy"));
    expect(await flashed(/^Copied to /)).toBeTruthy();
    expect(loadTodos("2026-12-25").map((t) => t.text)).toEqual(["Copy me"]);
    expect(loadTodos(T).map((t) => t.id)).toEqual(["Copy me"]);

    fireEvent.click(inItem("Copy me").getByLabelText("Move or copy to another day"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByLabelText("Day to move or copy to")).toBeNull();
  });

  it("won't move a daily task's copy", () => {
    addTodo("Daily", T, undefined, undefined, true);
    render(<TodosPage />);
    fireEvent.click(inItem("Daily").getByLabelText("Move or copy to another day"));
    expect((screen.getByText("Move") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the focus timer", () => {
  it("times a task, shows the time left, and records it when stopped", async () => {
    saveTodos([todo("Deep work", { start: 600, duration: 60 })], T);
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    render(<TodosPage />);
    fireEvent.click(inItem("Deep work").getByText("▶ Focus"));
    expect(screen.getByText("Focusing on")).toBeTruthy();
    expect(inItem("Deep work").getByText("Focusing")).toBeTruthy();
    expect(screen.getByText("left of 1h planned")).toBeTruthy();
    expect(screen.getByText("1:00:00")).toBeTruthy();
    now += 25 * 60_000;
    fireEvent.click(screen.getByText("Stop"));
    expect(await flashed('Recorded 25m on "Deep work"')).toBeTruthy();
    expect(loadTodos(T)[0]).toMatchObject({ spent: 25, completed: false });
  });

  it("marks the task done, and says when under a minute was recorded", async () => {
    saveTodos([todo("Quick"), todo("Quicker")], T);
    let now = 5_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    render(<TodosPage />);
    fireEvent.click(inItem("Quick").getByText("▶ Focus"));
    expect(screen.getByText("spent so far")).toBeTruthy(); // no time block: counts up
    now += 10 * 60_000;
    fireEvent.click(screen.getByText("Done", { selector: "button" }));
    expect(loadTodos(T).find((t) => t.id === "Quick")).toMatchObject({ spent: 10, completed: true });

    fireEvent.click(inItem("Quicker").getByText("▶ Focus"));
    now += 20_000;
    fireEvent.click(screen.getByText("Stop"));
    expect(await flashed("Under a minute, so nothing was recorded")).toBeTruthy();
  });

  it("goes over the planned time, notifies once, and starts from the block panel", () => {
    vi.stubGlobal("Notification", FakeNotification);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 2, 2, 12, 0));
    saveTodos([todo("Sprint", { start: 600, duration: 15, spent: 5 })], "2026-03-02");
    render(<TodosPage />);
    fireEvent.click(screen.getByText("Sprint", { selector: "span" }));
    fireEvent.click(within(screen.getByText("Remove from schedule").parentElement!).getByText("▶ Focus"));
    expect(screen.getByText("10:00")).toBeTruthy(); // 15 planned − 5 already spent
    vi.setSystemTime(new Date(2026, 2, 2, 12, 15));
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText(/^\+5:0\d$/)).toBeTruthy(); // 5 min over, plus the tick that redrew it
    expect(screen.getByText("over the 15m planned")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1000));
    expect(FakeNotification.sent).toEqual([{ title: "Time's up: Sprint", body: "Your planned time for this block is over." }]);
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(screen.getByText(/\(Today\)/)).toBeTruthy(); // the session's day, while another day is shown
  });

  it("formats long sessions with hours", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 2, 2, 8, 0));
    saveTodos([todo("Marathon")], "2026-03-02");
    render(<TodosPage />);
    fireEvent.click(inItem("Marathon").getByText("▶ Focus"));
    vi.setSystemTime(new Date(2026, 2, 2, 9, 2, 30));
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText("1:02:31")).toBeTruthy();
  });
});

describe("reminders", () => {
  it("turns reminders on or explains why it can't", async () => {
    render(<TodosPage />);
    const select = screen.getByLabelText("Reminders");
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
    fireEvent.change(select, { target: { value: "" } });
    expect(localStorage.getItem("reel-radar-reminder-lead")).toBeNull();
  });

  it("notifies for a block that's about to start", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    const start = Math.min(nowMinutes() + 3, 24 * 60 - 1);
    saveTodos([todo("Meeting", { start, duration: 30, note: "room 4" })], T);
    localStorage.setItem("reel-radar-reminder-lead", "5");
    render(<TodosPage />);
    await waitFor(() => expect(FakeNotification.sent).toHaveLength(1));
    expect(FakeNotification.sent[0].title).toBe("Meeting");
    expect(FakeNotification.sent[0].body).toMatch(/^In \d+ min · .*\nroom 4$/);
  });
});

describe("backup and sync", () => {
  it("exports the planner", () => {
    saveTodos([todo("A")], T);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<TodosPage />);
    fireEvent.click(screen.getByText("Export"));
    expect(click).toHaveBeenCalled();
  });

  it("imports a backup and reports what it added, or why it couldn't", async () => {
    const { container } = render(<TodosPage />);
    const input = container.querySelector<HTMLInputElement>("#import-file")!;
    const file = (body: unknown) => new File([JSON.stringify(body)], "b.json");
    fireEvent.change(input, { target: { files: [file({ app: "planner", version: 2, days: { [T]: [todo("Imported")] }, daily: [] })] } });
    expect(await flashed("Imported 1 todo across 1 day")).toBeTruthy();
    expect(screen.getByText("Imported", { selector: "p" })).toBeTruthy();
    fireEvent.change(input, {
      target: { files: [file({ app: "planner", version: 2, days: { [T]: [todo("x"), todo("y")], [Y]: [todo("z")] }, daily: [{ id: "d", text: "D", startDate: T }] })] },
    });
    expect(await flashed("Imported 3 todos across 2 days + 1 daily task")).toBeTruthy();
    fireEvent.change(input, { target: { files: [file({ nope: true })] } });
    expect(await flashed("Not a planner backup file.")).toBeTruthy();
    fireEvent.change(input, { target: { files: [] } });
  });

  it("syncs now, showing success or failure", async () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByText("Sync now"));
    expect(await screen.findByText("Synced")).toBeTruthy();
    routeFetch({ "/api/sync": () => jsonResponse({}, { status: 500 }) });
    await waitFor(() => expect(screen.getByText("Sync now")).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByText("Sync now"));
    expect(await screen.findByText("Failed")).toBeTruthy();
  });

  it("shows another device's changes when they arrive", async () => {
    render(<TodosPage />);
    saveTodos([todo("From phone")], T);
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: [`planner-${T.slice(0, 7)}`] } })));
    expect(await screen.findByText("From phone", { selector: "p" })).toBeTruthy();
  });
});
