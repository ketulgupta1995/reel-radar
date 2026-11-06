// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { jsonResponse } from "@/test/fixtures";
import { requests, routeFetch } from "@/test/pages";
import { addGoal, loadGoals, setGoalDone } from "@/lib/plannerSettings";
import { Todo, addTodo, getTodayDate, loadDayLog, loadDailyTasks, loadTodos, saveTodos, shiftDate, updateDayLog } from "@/lib/todos";

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
const longDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
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

const openDayLog = () => fireEvent.click(screen.getByText("Day log"));

// Pick a time on the clock face: hour, then minute, then AM/PM, then Done.
const setClock = (label: string, hour: number, minute: number, period: "AM" | "PM") => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByLabelText(`${hour} o'clock`));
  fireEvent.click(screen.getByLabelText(`${minute} minutes`));
  const clock = within(screen.getByRole("dialog"));
  fireEvent.click(clock.getByText(period));
  fireEvent.click(clock.getByText("Done"));
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

describe("header", () => {
  it("links to the lists and the stats", () => {
    render(<TodosPage />);
    expect(screen.getByText("Lists →").getAttribute("href")).toBe("/todos/lists");
    expect(screen.getByText("Stats →").getAttribute("href")).toBe("/todos/stats");
  });
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

  it("stays one line until opened, showing the day so far, with a glass of water to hand", () => {
    updateDayLog(T, { wake: "07:15", weight: 72.5 });
    render(<TodosPage />);
    expect(screen.queryByLabelText("Weight in kg")).toBeNull();
    expect(screen.getByText("Woke 7:15 AM · 72.5 kg · 0 L")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("More water"));
    expect(loadDayLog(T).water).toBe(250);
    expect(screen.getByText("Woke 7:15 AM · 72.5 kg · 0.25 L")).toBeTruthy();
    openDayLog();
    expect(screen.getByLabelText("Weight in kg")).toBeTruthy();
    openDayLog();
    expect(screen.queryByLabelText("Weight in kg")).toBeNull();
  });

  it("records wake time, sleep time and water for the day shown", async () => {
    render(<TodosPage />);
    openDayLog();
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
    expect(loadDayLog(T)).toMatchObject({ wake: "06:45", sleep: "23:15", water: 1000 });
    expect(loadDayLog(T).drinks).toHaveLength(3); // each logged with its time; "Less" dropped the latest
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1000");
    // Clearing a time removes it.
    fireEvent.click(screen.getByRole("button", { name: /^Woke up:/ }));
    fireEvent.click(screen.getByText("Clear"));
    expect(loadDayLog(T)).toMatchObject({ sleep: "23:15", water: 1000 });
    // The notes stay closed until asked for, and keep what you type.
    expect(screen.queryByLabelText("What went well")).toBeNull();
    fireEvent.click(screen.getByText("How did the day go?"));
    fireEvent.change(screen.getByLabelText("What went well"), { target: { value: "Shipped it" } });
    fireEvent.change(screen.getByLabelText("What went badly"), { target: { value: "Skipped lunch" } });
    fireEvent.change(screen.getByLabelText("What to improve"), { target: { value: "Plan breaks" } });
    expect(loadDayLog(T)).toMatchObject({ sleep: "23:15", water: 1000, well: "Shipped it", bad: "Skipped lunch", improve: "Plan breaks" });
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
    openDayLog();
    const input = screen.getByLabelText("Weight in kg") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "72.5" } });
    expect(loadDayLog(T)).toEqual({ weight: 72.5 });
    fireEvent.change(input, { target: { value: "" } });
    expect(loadDayLog(T)).toEqual({});
    fireEvent.change(input, { target: { value: "71" } });
    fireEvent.click(screen.getByLabelText("Previous day"));
    await waitFor(() => expect((screen.getByLabelText("Weight in kg") as HTMLInputElement).value).toBe(""));
  });

  it("flags a day's notes on the closed log, shows them when opened, and caps the goal bar", () => {
    localStorage.setItem(
      "reel-radar-planner-log",
      JSON.stringify({ items: [{ date: T, updatedAt: 1, log: { improve: "Sleep earlier", water: 3000 } }] })
    );
    render(<TodosPage />);
    expect(screen.getByLabelText("has notes")).toBeTruthy();
    openDayLog();
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

  it("opens a day from the strip around today, which shows how each day went", async () => {
    const other = shiftDate(T, 1);
    saveTodos([todo("w1", { completed: true }), todo("w2")], other);
    render(<TodosPage />);
    const days = screen.getAllByLabelText(/: (nothing planned|\d+ of \d+ done)$/);
    expect(days).toHaveLength(7);
    expect(days[3].getAttribute("aria-current")).toBe("date"); // today in the middle
    expect(days[3].getAttribute("aria-label")).toMatch(/nothing planned$/);
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
    fireEvent.click(screen.getByTitle("Repeat this task"));
    fireEvent.click(screen.getByLabelText("Sun"));
    fireEvent.click(screen.getByLabelText("Sat"));
    expect(screen.getByTitle("Repeat this task").textContent).toBe("↻ Weekdays");
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
    fireEvent.change(screen.getByPlaceholderText("Filter this day"), { target: { value: "noon" } });
    expect(rows()).toEqual(["Urgent"]); // matches the note
    fireEvent.change(screen.getByPlaceholderText("Filter this day"), { target: { value: "zzz" } });
    expect(screen.getByText("No tasks match this filter.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Filter this day"), { target: { value: "" } });
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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(longDate(Y));
    fireEvent.click(screen.getByText("Today"));
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(longDate(shiftDate(T, 1)));
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: "2026-03-02" } });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mon, Mar 2, 2026");
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: "" } }); // ignored

    fireEvent.click(screen.getByText("week"));
    expect(screen.getByText("Week of Mar 2 – Mar 8")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(screen.getByText("Week of Mar 9 – Mar 15")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous week"));
    fireEvent.click(screen.getByTitle(/^Open Wed, Mar 4/));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Wed, Mar 4, 2026");
    fireEvent.click(screen.getByText("week"));
    fireEvent.click(screen.getByText("day"));
  });

  it("offers every past day's unfinished tasks as overdue, one or all", async () => {
    saveTodos([todo("Left"), todo("Finished", { completed: true })], Y);
    saveTodos([todo("Ancient", { priority: "high" })], shiftDate(T, -20));
    addTodo("Repeats", Y, undefined, undefined, true);
    render(<TodosPage />);
    await screen.findByText("2 overdue tasks");
    fireEvent.click(screen.getByText("Choose"));
    fireEvent.click(screen.getByLabelText("Move “Ancient” to today"));
    expect(await flashed("Moved 1 task to today")).toBeTruthy();
    expect(loadTodos(T).map((t) => t.id)).toContain("Ancient");
    expect(loadTodos(T).find((t) => t.id === "Ancient")!.postponed).toBe(1);
    fireEvent.click(screen.getByText("Move all to today"));
    expect(loadTodos(T).map((t) => t.id)).toContain("Left");
    expect(screen.queryByText(/overdue task/)).toBeNull();
  });

  it("drops an overdue task, with undo back to its own day", async () => {
    const old = shiftDate(T, -5);
    saveTodos([todo("Stale")], old);
    render(<TodosPage />);
    fireEvent.click(await screen.findByText("1 overdue task"));
    expect(screen.getByText("Hide")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Drop “Stale”"));
    expect(loadTodos(old)).toEqual([]);
    fireEvent.click(await screen.findByText("Undo"));
    expect(loadTodos(old).map((t) => t.id)).toEqual(["Stale"]);
    expect(loadTodos(T).map((t) => t.id)).not.toContain("Stale");
    fireEvent.click(screen.getByText("Hide"));
    expect(screen.getByText("Choose")).toBeTruthy();
  });

  it("asks to drop or break down a task postponed 3 times, in the tray and the list", async () => {
    const old = shiftDate(T, -5);
    saveTodos([todo("Taxes", { postponed: 3 })], old);
    saveTodos([todo("Dentist", { postponed: 4 })], T);
    saveTodos([todo("Fine", { postponed: 2 })], Y);
    render(<TodosPage />);
    expect((await screen.findAllByText("Postponed 4 times. Drop it or break it down?")).length).toBe(1);
    fireEvent.click(await screen.findByText("2 overdue tasks"));
    expect(screen.getByText("Postponed 3 times. Drop it or break it down?")).toBeTruthy();
    expect(screen.queryByText(/Postponed 2 times/)).toBeNull();
    // Break the overdue one down in place.
    fireEvent.click(screen.getAllByText("Break it down")[0]);
    const input = screen.getByLabelText("A smaller step for “Taxes”");
    fireEvent.submit(input);
    expect(loadTodos(old)[0].subtasks).toBeUndefined();
    fireEvent.change(input, { target: { value: "Find the forms" } });
    fireEvent.click(screen.getByText("Add step"));
    expect(loadTodos(old)[0].subtasks!.map((s) => s.text)).toEqual(["Find the forms"]);
    expect(screen.getByText("· Find the forms")).toBeTruthy();
    // And drop the one in today's list.
    const dentist = screen.getByText("Postponed 4 times. Drop it or break it down?").parentElement!;
    fireEvent.click(within(dentist).getByText("Drop it"));
    expect(loadTodos(T).map((t) => t.id)).not.toContain("Dentist");
    fireEvent.click(screen.getByText("Drop it"));
    expect(loadTodos(old)).toEqual([]);
  });

  it("still offers the day before when looking at another day", async () => {
    saveTodos([todo("Left"), todo("Also", { priority: "high" })], T);
    render(<TodosPage />);
    fireEvent.click(screen.getByLabelText("Next day"));
    await screen.findByText("2 unfinished tasks from Today");
    fireEvent.click(screen.getByText("Choose"));
    fireEvent.click(screen.getAllByText("+ Add")[0]);
    expect(await flashed("Added 1 task from Today")).toBeTruthy();
    fireEvent.click(screen.getByText("Add all"));
    expect(screen.queryByText(/unfinished task/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Previous day"));
  });

  it("closes the tray on another day or view, but not when its last task is dropped and undone", async () => {
    saveTodos([todo("Stale")], Y);
    render(<TodosPage />);
    fireEvent.click(await screen.findByText("1 overdue task"));
    fireEvent.click(screen.getByLabelText("Drop “Stale”"));
    expect(screen.queryByText(/overdue task/)).toBeNull();
    fireEvent.click(await screen.findByText("Undo"));
    expect(screen.getByText("Hide")).toBeTruthy();

    fireEvent.click(screen.getByText("week"));
    fireEvent.click(screen.getByText("day"));
    expect(await screen.findByText("Choose")).toBeTruthy();
  });

  it("closes the carry-over tray when moving between days that both have one", async () => {
    saveTodos([todo("Two back")], shiftDate(T, -2));
    saveTodos([todo("Three back")], shiftDate(T, -3));
    render(<TodosPage />);
    fireEvent.click(screen.getByLabelText("Previous day"));
    fireEvent.click(await screen.findByText(/1 unfinished task from/));
    expect(screen.getByText("Hide")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous day"));
    await screen.findByText(/unfinished task from/);
    expect(screen.getByText("Choose")).toBeTruthy();
    expect(screen.queryByText("Hide")).toBeNull();
  });

  it("pulls past months once, so older overdue tasks are found on a new device", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 0, 15, 12, 0));
    fetch = routeFetch({
      "/api/sync": (url, init) => {
        if (init?.method === "POST") return { etag: '"e"' };
        return decodeURIComponent(url.search).includes("planner-2026-11")
          ? { docs: { "planner-2026-11": { etag: '"m"', data: { items: [{ date: "2026-11-20", pos: 0, todo: todo("Remote old"), updatedAt: 1 }] } } } }
          : { docs: {} };
      },
    });
    render(<TodosPage />);
    expect(await screen.findByText("1 overdue task")).toBeTruthy();
    const asked = requests(fetch, "/api/sync").filter((r) => decodeURIComponent(r.url.search).includes("planner-2026-11"));
    expect(asked).toHaveLength(1);
  });

  it("suggests a realistic length for a block, from how long that tag's blocks really ran", async () => {
    const done = (id: string) => todo(id, { tag: "work", start: 540, duration: 60, spent: 90, completed: true });
    saveTodos([done("a"), done("b"), done("c")], Y);
    saveTodos([todo("Plan it", { tag: "work", start: 600, duration: 60 }), todo("Other", { tag: "home", start: 800, duration: 60 })], T);
    render(<TodosPage />);
    fireEvent.click(await screen.findByText("Other", { selector: "span" }));
    expect(screen.queryByText(/usually run/)).toBeNull();
    fireEvent.click(screen.getByText("Plan it", { selector: "span" }));
    expect(screen.getByText(/Work blocks usually run 50% over/)).toBeTruthy();
    fireEvent.click(screen.getByText("Use 1h 30m"));
    expect(loadTodos(T).find((t) => t.id === "Plan it")!.duration).toBe(90);
    expect(screen.queryByText(/usually run/)).toBeTruthy();
    expect(screen.queryByText("Use 1h 30m")).toBeNull();
  });

  it("nudges for the weekly review on an unreviewed Sunday only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 1, 12, 0)); // a Sunday
    const { unmount } = render(<TodosPage />);
    expect((await screen.findByText("Start review →")).closest("a")!.getAttribute("href")).toBe("/todos/review");
    unmount();
    updateDayLog("2026-03-01", { reviewedAt: 1 });
    const again = render(<TodosPage />);
    await waitFor(() => expect(screen.queryByText("Start review →")).toBeNull());
    again.unmount();
    localStorage.clear();
    vi.setSystemTime(new Date(2026, 2, 2, 12, 0)); // Monday
    render(<TodosPage />);
    await waitFor(() => expect(screen.getByText("Review →")).toBeTruthy());
    expect(screen.queryByText("Start review →")).toBeNull();
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

describe("next up", () => {
  const card = () => screen.queryByRole("region", { name: "Next up" });

  it("shows today's next task, and finishes or starts it from the card", async () => {
    const later = (nowMinutes() + 30) % 1440;
    saveTodos([todo("Inbox"), todo("Timed", { start: later, duration: 15 })], T);
    render(<TodosPage />);
    await waitFor(() => expect(card()).toBeTruthy());
    const first = within(card()!).getByLabelText(/^Finish/).getAttribute("aria-label")!;
    const name = first.includes("Timed") ? "Timed" : "Inbox";
    const other = name === "Timed" ? "Inbox" : "Timed";

    fireEvent.click(within(card()!).getByLabelText(`Finish “${name}”`));
    expect(loadTodos(T).find((t) => t.id === name)!.completed).toBe(true);
    expect(within(card()!).getByText(other)).toBeTruthy();

    // While focusing, the focus bar takes over.
    fireEvent.click(within(card()!).getByLabelText(`Focus on “${other}”`));
    expect(card()).toBeNull();
  });

  it("isn't shown on another day, or when nothing's left", async () => {
    saveTodos([todo("Tomorrow's")], shiftDate(T, 1));
    render(<TodosPage />);
    await waitFor(() => expect(screen.getByText(/nothing planned|Nothing planned/)).toBeTruthy());
    expect(card()).toBeNull();
    fireEvent.click(screen.getByLabelText("Next day"));
    await screen.findByText("Tomorrow's", { selector: "p" });
    expect(card()).toBeNull();
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
  const fakeWorker = (subscribe = vi.fn(async () => ({ endpoint: "https://fcm.googleapis.com/x", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/x" }) }))) => {
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe }, showNotification: vi.fn(async (_title: string) => {}) };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) },
    });
    vi.stubGlobal("PushManager", class {});
    return reg;
  };
  afterEach(() => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it("subscribes the device when reminders go on, and says they work with the app closed", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    fakeWorker();
    fetch = routeFetch({ "/api/push": { publicKey: "AQAB" } });
    render(<TodosPage />);
    fireEvent.change(screen.getByLabelText("Reminders"), { target: { value: "10" } });
    expect(await flashed("Reminders on, even with the app closed")).toBeTruthy();
    const post = requests(fetch, "/api/push").find((r) => r.init?.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toMatchObject({ lead: 10, timeZone: expect.any(String) });
  });

  it("falls back to the open page when the server has no push set up", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    fakeWorker();
    routeFetch({ "/api/push": () => jsonResponse({}, { status: 503 }) });
    render(<TodosPage />);
    fireEvent.change(screen.getByLabelText("Reminders"), { target: { value: "5" } });
    expect(await flashed("Reminders on while this page is open")).toBeTruthy();
  });

  it("refreshes the subscription on open when reminders were already on", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    fakeWorker();
    fetch = routeFetch({ "/api/push": { publicKey: "AQAB" } });
    localStorage.setItem("reel-radar-reminder-lead", "5");
    render(<TodosPage />);
    await waitFor(() => expect(requests(fetch, "/api/push").some((r) => r.init?.method === "POST")).toBe(true));
  });

  it("shows page reminders through the service worker when there is one", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    const reg = fakeWorker();
    routeFetch({ "/api/push": { publicKey: "AQAB" } });
    saveTodos([todo("Meeting", { start: Math.min(nowMinutes() + 3, 24 * 60 - 1), duration: 30 })], T);
    localStorage.setItem("reel-radar-reminder-lead", "5");
    render(<TodosPage />);
    await waitFor(() => expect(reg.showNotification).toHaveBeenCalled());
    expect(reg.showNotification.mock.calls[0][0]).toBe("Meeting");
    expect(FakeNotification.sent).toEqual([]);
  });

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

describe("flexible repeats", () => {
  const openRepeat = () => fireEvent.click(screen.getByTitle("Repeat this task"));

  it("adds a task every few days", () => {
    render(<TodosPage />);
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Water plants" } });
    openRepeat();
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "every" } });
    fireEvent.change(screen.getByLabelText("Every how many days"), { target: { value: "5" } });
    expect(screen.getByTitle("Repeat this task").textContent).toBe("↻ Every 5 days");
    fireEvent.click(screen.getByText("Add"));
    expect(loadDailyTasks()[0]).toMatchObject({ text: "Water plants", every: 5 });
  });

  it("adds a times-a-week task and shows progress toward it", () => {
    render(<TodosPage />);
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Run" } });
    openRepeat();
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "timesPerWeek" } });
    fireEvent.change(screen.getByLabelText("Times a week"), { target: { value: "4" } });
    fireEvent.click(screen.getByText("Add"));
    expect(loadDailyTasks()[0]).toMatchObject({ timesPerWeek: 4 });
    expect(screen.getByTitle("Choose how it repeats").textContent).toBe("↻ 4× a week · 0/4");
    fireEvent.click(screen.getByLabelText(/Mark.*Run.*done|Complete/i, { selector: "input,button" }));
    expect(screen.getByTitle("Choose how it repeats").textContent).toBe("↻ 4× a week · 1/4");
  });

  it("adds a monthly task due another day without cluttering today, and says so", async () => {
    const dom = Number(T.slice(8));
    const other = dom === 1 ? 2 : 1;
    render(<TodosPage />);
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Pay rent" } });
    openRepeat();
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "monthDay" } });
    fireEvent.change(screen.getByLabelText("Day of the month"), { target: { value: String(other) } });
    fireEvent.click(screen.getByText("Add"));
    expect(await flashed(/Monthly on the (1st|2nd)\. Nothing to do until then\./)).toBeTruthy();
    expect(loadTodos(T)).toEqual([]);
    expect(loadDailyTasks()[0]).toMatchObject({ monthDay: other });
    openRepeat();
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "monthDay" } });
    fireEvent.change(screen.getByLabelText("Day of the month"), { target: { value: "31" } });
    expect(screen.getByText("Shorter months use their last day.")).toBeTruthy();
  });

  it("changes an existing repeating task's rule and marks weekly streaks", () => {
    addTodo("Yoga", T, undefined, undefined, true);
    render(<TodosPage />);
    fireEvent.click(screen.getByTitle("Choose how it repeats"));
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "every" } });
    expect(loadDailyTasks()[0]).toMatchObject({ every: 2 });
    expect(screen.getByTitle("Choose how it repeats").textContent).toBe("↻ Every 2 days");
    fireEvent.change(screen.getByLabelText("How it repeats"), { target: { value: "days" } });
    expect(loadDailyTasks()[0].every).toBeUndefined();
    fireEvent.click(screen.getByLabelText("Sun"));
    expect(loadDailyTasks()[0].days).toEqual([1, 2, 3, 4, 5, 6]);
    fireEvent.click(screen.getByLabelText("Sun"));
    expect(loadDailyTasks()[0].days).toBeUndefined();
  });
});

describe("dates in the add box", () => {
  it("previews the date and repeat before anything is added", () => {
    render(<TodosPage />);
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Pay rent on the 1st" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toContain("↻ Monthly on the 1st");
    fireEvent.change(screen.getByPlaceholderText("What needs to be done today?"), { target: { value: "Dentist tomorrow" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toContain("📅");
  });

  it("adds to the named day, pulling its month first, and stays on this day", async () => {
    const tomorrow = shiftDate(T, 1);
    fetch = routeFetch();
    render(<TodosPage />);
    await waitFor(() => expect(requests(fetch, "/api/sync").length).toBeGreaterThan(0));
    fetch.mockClear();
    const input = screen.getByPlaceholderText("What needs to be done today?");
    fireEvent.change(input, { target: { value: "Dentist tomorrow 3pm #health" } });
    fireEvent.click(screen.getByText("Add"));
    expect((input as HTMLInputElement).value).toBe(""); // cleared at once, so Enter twice can't double it
    expect(await flashed(/^Added to /)).toBeTruthy();
    expect(loadTodos(tomorrow)[0]).toMatchObject({ text: "Dentist", start: 15 * 60, tag: "health" });
    expect(loadTodos(T)).toEqual([]);
    expect(screen.queryByText("Dentist", { selector: "p" })).toBeNull();
  });
});

describe("templates and tags", () => {
  it("saves a day as a template and applies it to another day", async () => {
    saveTodos([todo("Standup", { start: 570, duration: 15 })], T);
    render(<TodosPage />);
    fireEvent.click(screen.getByText(/^templates/));
    expect(screen.getByText(/Save a day's tasks and times as a layout/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Workday" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await flashed("Saved “Workday” with 1 task")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next day"));
    await screen.findByPlaceholderText(/Add a task for/);
    fireEvent.click(screen.getByLabelText("Apply “Workday”"));
    expect(await flashed("Added 1 task from “Workday”")).toBeTruthy();
    expect(loadTodos(shiftDate(T, 1))[0]).toMatchObject({ text: "Standup", start: 570 });
    fireEvent.click(screen.getByLabelText("Apply “Workday”"));
    expect(await flashed("Everything in “Workday” is already on this day")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Delete “Workday”"));
    fireEvent.click(screen.getByText("Delete it?"));
    expect(screen.queryByText("Workday")).toBeNull();
    fireEvent.click(screen.getByText(/^templates/));
    expect(screen.queryByLabelText("Template name")).toBeNull();
  });

  it("explains when there's nothing to save, and ignores a blank name", async () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByText(/^templates/));
    fireEvent.submit(screen.getByLabelText("Template name"));
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Empty" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await flashed("This day has no one-off tasks to save")).toBeTruthy();
  });

  it("adds, renames and removes tags, and shows them everywhere", async () => {
    saveTodos([todo("Task", { tag: "work" })], T);
    render(<TodosPage />);
    fireEvent.click(screen.getByText(/^tags/));
    fireEvent.change(screen.getByLabelText("Rename Work"), { target: { value: "Job" } });
    fireEvent.blur(screen.getByLabelText("Rename Work"));
    await waitFor(() => expect(inItem("Task").getAllByText("Job").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "Deep work" } });
    fireEvent.click(screen.getAllByText("Add").find((b) => b.closest("form")?.querySelector('[aria-label="New tag"]'))!);
    expect(await screen.findByLabelText("Rename Deep work")).toBeTruthy();
    expect((screen.getByLabelText("New tag") as HTMLInputElement).value).toBe("");

    // Offered in the add box, by shorthand too.
    const input = screen.getByPlaceholderText("What needs to be done today?");
    fireEvent.change(input, { target: { value: "Write #deepwork" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toContain("Deep work");
    fireEvent.change(input, { target: { value: "" } });

    // A removed tag stops being offered but stays on its task.
    fireEvent.click(screen.getByLabelText("Remove Job"));
    await waitFor(() => expect(screen.queryByLabelText("Rename Job")).toBeNull());
    expect(inItem("Task").getAllByText("Job").length).toBeGreaterThan(0);
  });

  it("refuses a duplicate name or an empty one, keeping the old name", async () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByText(/^tags/));
    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "home" } });
    fireEvent.submit(screen.getByLabelText("New tag"));
    expect(await flashed("There's already a home tag")).toBeTruthy();
    const work = screen.getByLabelText("Rename Work") as HTMLInputElement;
    fireEvent.change(work, { target: { value: "Home" } });
    fireEvent.keyDown(work, { key: "Enter" });
    fireEvent.blur(work);
    expect(await flashed("There's already a Home tag")).toBeTruthy();
    expect(work.value).toBe("Work");
  });
});

describe("auto-schedule", () => {
  const hours = (h: number) => `${String(h).padStart(2, "0")}:00`;
  // Tomorrow, so the current time doesn't limit the plan.
  const D = shiftDate(T, 1);
  const open = async () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByLabelText("Next day"));
    await screen.findByPlaceholderText(/Add a task for/);
  };

  it("proposes blocks by priority, lets them be changed, and saves only on apply", async () => {
    updateDayLog(D, { wake: hours(9), sleep: hours(21) });
    saveTodos([todo("Low one", { priority: "low" }), todo("Top one", { priority: "high", duration: 30 }), todo("Busy", { start: 9 * 60 + 30, duration: 60 }), todo("Drop me")], D);
    await open();
    fireEvent.click(screen.getByText("✨ Auto-schedule"));
    expect(screen.getByRole("region", { name: "Proposed schedule" }).textContent).toContain("between 9 AM and 9 PM");
    expect((screen.getByLabelText("Start time for “Top one”") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("Start time for “Low one”") as HTMLInputElement).value).toBe("11:30");
    expect(loadTodos(D).find((t) => t.id === "Top one")!.start).toBeUndefined(); // nothing saved yet

    fireEvent.change(screen.getByLabelText("Start time for “Low one”"), { target: { value: "15:00" } });
    fireEvent.change(screen.getByLabelText("Start time for “Low one”"), { target: { value: "" } }); // cleared mid-edit
    fireEvent.change(screen.getByLabelText("Length of “Low one”"), { target: { value: "90" } });
    fireEvent.click(screen.getByLabelText("Leave “Drop me” out"));
    fireEvent.click(screen.getByText("Apply"));
    expect(await flashed("Scheduled 2 tasks")).toBeTruthy();
    const saved = loadTodos(D);
    expect(saved.find((t) => t.id === "Low one")).toMatchObject({ start: 15 * 60, duration: 90 });
    expect(saved.find((t) => t.id === "Top one")).toMatchObject({ start: 9 * 60, duration: 30 });
    expect(saved.find((t) => t.id === "Drop me")!.start).toBeUndefined();
  });

  it("can be cancelled, says what didn't fit, and leaves repeating tasks alone", async () => {
    updateDayLog(D, { wake: hours(20), sleep: hours(21) });
    saveTodos([todo("Fits", { duration: 60 }), todo("Too much", { duration: 60 }), todo("Repeats", { dailyId: "d" })], D);
    await open();
    fireEvent.click(screen.getByText("✨ Auto-schedule"));
    expect(screen.getByText("Didn't fit: Too much")).toBeTruthy();
    expect(screen.getByText(/Left out 1 repeating task/)).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("region", { name: "Proposed schedule" })).toBeNull();
    expect(loadTodos(D).every((t) => t.start === undefined)).toBe(true);
  });

  it("isn't offered without something to place, and shows when there's no room", async () => {
    updateDayLog(D, { wake: hours(23), sleep: hours(23) });
    saveTodos([todo("Done", { completed: true })], D);
    await open();
    expect(screen.queryByText("✨ Auto-schedule")).toBeNull();
    saveTodos([todo("Done", { completed: true }), todo("Open")], D);
    fireEvent.click(screen.getByLabelText("Previous day"));
    await screen.findByPlaceholderText("What needs to be done today?");
    fireEvent.click(screen.getByLabelText("Next day"));
    fireEvent.click(await screen.findByText("✨ Auto-schedule"));
    expect(screen.getByText(/No free time/)).toBeTruthy();
    expect((screen.getByText("Apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("doesn't plan in the past today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 2, 13, 5));
    saveTodos([todo("Later")], "2026-03-02");
    render(<TodosPage />);
    await waitFor(() => expect(screen.getByText("✨ Auto-schedule")).toBeTruthy());
    fireEvent.click(screen.getByText("✨ Auto-schedule"));
    expect((screen.getByLabelText("Start time for “Later”") as HTMLInputElement).value).toBe("13:15");
    fireEvent.click(screen.getByText("Apply"));
    expect(loadTodos("2026-03-02")[0].start).toBe(13 * 60 + 15);
  });
});

describe("month view", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0));
  });

  it("shows finished tasks as a heatmap, with totals, and opens a day on click", async () => {
    const done = (id: string) => todo(id, { completed: true });
    saveTodos([done("a"), done("b"), done("c"), done("d"), done("e"), done("f"), done("g"), done("h"), todo("open")], "2026-03-05");
    saveTodos([done("x")], "2026-03-06");
    render(<TodosPage />);
    fireEvent.click(screen.getByText("month"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("March 2026");
    const cell = await screen.findByRole("button", { name: /Mar 5: 8 of 9 tasks finished/ });
    expect(cell.textContent).toContain("8");
    expect(screen.getByRole("button", { name: /Mar 6: 1 of 1 task finished/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mar 7: nothing planned/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mar 15/ }).getAttribute("aria-current")).toBe("date");
    expect(screen.getByText("tasks this month").previousElementSibling!.textContent).toBe("9");
    expect(screen.getByText("of 31")).toBeTruthy();
    expect(screen.getByText("8 finished")).toBeTruthy();
    expect(screen.getByText("8+")).toBeTruthy(); // legend

    fireEvent.click(cell);
    expect(await screen.findByText("h", { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Mar");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("5");
  });

  it("moves by month, keeping within shorter months", async () => {
    vi.setSystemTime(new Date(2026, 0, 31, 12, 0));
    render(<TodosPage />);
    fireEvent.click(screen.getByText("month"));
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("February 2026");
    expect((screen.getByLabelText("Pick a date") as HTMLInputElement).value).toBe("2026-02-28");
    fireEvent.click(screen.getByLabelText("Previous month"));
    fireEvent.click(screen.getByLabelText("Previous month"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("December 2025");
    expect(await screen.findByText("nothing finished yet")).toBeTruthy();
  });

  it("switches and steps by keyboard", () => {
    render(<TodosPage />);
    fireEvent.keyDown(document.body, { key: "m" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("March 2026");
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("April 2026");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.getByPlaceholderText("What needs to be done today?")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "m" });
    fireEvent.keyDown(document.body, { key: "m" });
    expect(screen.queryByText("of 31")).toBeNull();
  });

  it("takes in a month that arrives from the server", async () => {
    routeFetch({
      "/api/sync": (url, init) => {
        if (init?.method === "POST") return { etag: '"e"' };
        return decodeURIComponent(url.search).includes("planner-2026-03")
          ? { docs: { "planner-2026-03": { etag: '"m"', data: { items: [{ date: "2026-03-02", pos: 0, todo: todo("Remote", { completed: true }), updatedAt: 1 }] } } } }
          : { docs: {} };
      },
    });
    render(<TodosPage />);
    fireEvent.click(screen.getByText("month"));
    expect(await screen.findByRole("button", { name: /Mar 2: 1 of 1 task finished/ })).toBeTruthy();
  });
});

describe("backup and sync", () => {
  it("exports the planner", async () => {
    saveTodos([todo("A")], T);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<TodosPage />);
    fireEvent.click(screen.getByText("Export"));
    expect(await flashed("Backup saved")).toBeTruthy();
    expect(click).toHaveBeenCalled();
  });

  it("warns when a backup couldn't pull from the server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    routeFetch({ "/api/sync": () => jsonResponse({}, { status: 500 }) });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<TodosPage />);
    fireEvent.click(screen.getByText("Export"));
    expect(await flashed("Couldn't reach the server, so the backup only has this device's copy")).toBeTruthy();
    expect(click).toHaveBeenCalled();
  });

  it("reports the day logs and list items an import added, and shows the log", async () => {
    const { container } = render(<TodosPage />);
    const backup = {
      app: "planner",
      version: 3,
      days: { [T]: [todo("A")] },
      daily: [],
      log: { [T]: { weight: 71 }, [Y]: { water: 500 } },
      lists: { lists: [{ id: "l", name: "Gifts", createdAt: 1 }], items: [{ id: "i", listId: "l", text: "Scarf", done: false, createdAt: 1 }] },
    };
    fireEvent.change(container.querySelector("#import-file")!, { target: { files: [new File([JSON.stringify(backup)], "b.json")] } });
    expect(await flashed("Imported 1 todo across 1 day + 2 day logs + 1 list item")).toBeTruthy();
    expect(loadDayLog(T).weight).toBe(71);
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

describe("task groups", () => {
  const at = (h: number, m = 0) => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(`${T}T00:00:00`).setHours(h, m));
  };
  afterEach(() => vi.useRealTimers());

  it("labels the to-do and completed groups", async () => {
    at(9, 0);
    saveTodos([todo("Milk", { completed: true })], T);
    render(<TodosPage />);
    expect(await screen.findByText("Completed · 1")).toBeTruthy();
    saveTodos([todo("Milk", { completed: true }), todo("Eggs")], T);
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: [`planner-${T.slice(0, 7)}`] } })));
    expect(await screen.findByText("To do · 1")).toBeTruthy();
  });
});

describe("task creator options", () => {
  it("keeps a half-written task when switching to another view and back", async () => {
    render(<TodosPage />);
    const box = () => screen.getByPlaceholderText("What needs to be done today?") as HTMLInputElement;
    fireEvent.change(box(), { target: { value: "Half written" } });
    fireEvent.click(screen.getByText("⋯ Options"));
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });

    fireEvent.click(screen.getByText("week"));
    expect(screen.queryByPlaceholderText("What needs to be done today?")).toBeNull();
    fireEvent.click(screen.getByText("day"));

    await waitFor(() => expect(box().value).toBe("Half written"));
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe("high");
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(loadTodos(T).map((t) => t.text)).toContain("Half written"));
    expect(loadTodos(T).find((t) => t.text === "Half written")!.priority).toBe("high");
  });

  it("keeps priority, tag, time, note and repeat behind Options until asked for or in use", () => {
    render(<TodosPage />);
    const toggle = screen.getByText("⋯ Options");
    const panel = () => screen.getByLabelText("Priority").parentElement!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel().className).toContain("hidden");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel().className).not.toContain("hidden");
    fireEvent.click(toggle);
    expect(panel().className).toContain("hidden");
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } }); // set, so it stays open
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("schedule day marks", () => {
  it("marks wake, sleep and each drink on the schedule at the time it was logged", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(`${T}T00:00:00`).setHours(14, 7));
    try {
      render(<TodosPage />);
      expect(screen.queryAllByTestId("day-mark")).toHaveLength(0);
      openDayLog();
      setClock("Woke up", 6, 30, "AM");
      setClock("Went to sleep", 10, 30, "PM");
      fireEvent.click(screen.getByLabelText("More water"));
      fireEvent.click(screen.getByLabelText("Add a bottle")); // same quarter hour: added together
      const marks = screen.getAllByTestId("day-mark").map((m) => m.textContent);
      expect(marks).toEqual(["🌅 Woke 6:30 AM", "😴 Sleep 10:30 PM", "💧 750 ml · 2 PM"]);
      expect(Element.prototype.scrollTo).toHaveBeenCalledWith({ top: ((14 * 60 + 7) / 60) * 64, behavior: "smooth" });
      fireEvent.click(screen.getByLabelText("Less water")); // takes off the latest drink
      expect(screen.getAllByTestId("day-mark").map((m) => m.textContent)[2]).toBe("💧 250 ml · 2 PM");
      fireEvent.click(screen.getByLabelText("Less water"));
      expect(screen.getAllByTestId("day-mark")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("schedule done marks", () => {
  it("marks when a task and a checklist item were ticked off, and drops the mark when undone", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(`${T}T00:00:00`).setHours(15, 5));
    try {
      saveTodos([todo("Report", { subtasks: [{ id: "s1", text: "Draft", done: false }] }), todo("Milk")], T);
      render(<TodosPage />);
      const marks = () => screen.queryAllByTestId("day-mark").map((m) => m.textContent);
      expect(marks()).toEqual([]);
      fireEvent.click(inItem("Report").getByLabelText('Mark "Draft" as done'));
      expect(marks()).toEqual(["✓ Draft3:05 PM"]);
      fireEvent.click(inItem("Milk").getByLabelText("Mark as complete"));
      expect(marks()).toEqual(["✓ Draft3:05 PM", "✓ Milk3:05 PM"]);
      expect(screen.getByTitle("Milk · done 3:05 PM")).toBeTruthy();
      expect(screen.getByTitle("Draft (Report) · done 3:05 PM")).toBeTruthy();
      fireEvent.click(inItem("Milk").getByLabelText("Mark as incomplete"));
      expect(marks()).toEqual(["✓ Draft3:05 PM"]);
      fireEvent.click(inItem("Report").getByLabelText('Mark "Draft" as not done'));
      expect(marks()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names every item ticked in a burst, stacked in order with its own time", () => {
    const at = (h: number, m: number) => new Date(`${T}T00:00:00`).setHours(h, m);
    saveTodos(
      [
        todo("Brush", { completed: true, doneAt: at(13, 0) }),
        todo("Bath", { completed: true, doneAt: at(13, 0) }),
        todo("Lunch", { completed: true, doneAt: at(13, 10) }),
        todo("Walk", { completed: true, doneAt: at(15, 0) }),
      ],
      T
    );
    render(<TodosPage />);
    const marks = screen.getAllByTestId("day-mark");
    expect(marks.map((m) => m.textContent)).toEqual(["✓ Brush1 PM", "✓ Bath1 PM", "✓ Lunch1:10 PM", "✓ Walk3 PM"]);
    const tops = marks.map((m) => parseFloat((m.querySelector("span") as HTMLElement).style.top));
    expect(tops[0]).toBe(0);
    expect(tops[1]).toBe(22);
    expect(tops[2]).toBeCloseTo(44 - (10 / 60) * 64);
    expect(tops[3]).toBe(0);
  });

  it("keeps blocks clear of the Done column, which only shows when something is in it", () => {
    saveTodos([todo("Review", { start: 15 * 60, duration: 60 })], T);
    const { unmount } = render(<TodosPage />);
    const plan = () => screen.getByTestId("plan-column");
    expect(within(plan()).getByText("Review")).toBeTruthy();
    expect(plan().className).toContain("right-0");
    expect(screen.queryByText("Done", { selector: "div" })).toBeNull();
    unmount();
    saveTodos([todo("Review", { start: 15 * 60, duration: 60, completed: true, doneAt: new Date(`${T}T00:00:00`).setHours(15, 30) })], T);
    render(<TodosPage />);
    expect(plan().className).toContain("right-[clamp(7.5rem,38%,13rem)]");
    expect(screen.getByText("Done", { selector: "div" })).toBeTruthy();
    expect(screen.getByTestId("day-mark").querySelector("span")!.className).toContain("w-[clamp(7.5rem,38%,13rem)]");
  });

  it("draws a done mark just below a water mark it would land on", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(`${T}T00:00:00`).setHours(15, 5));
    try {
      saveTodos([todo("Milk")], T);
      render(<TodosPage />);
      openDayLog();
      fireEvent.click(screen.getByLabelText("More water"));
      fireEvent.click(inItem("Milk").getByLabelText("Mark as complete"));
      const spans = screen.getAllByTestId("day-mark").map((m) => m.querySelector("span") as HTMLElement);
      expect(spans.map((s) => s.textContent)).toEqual(["💧 250 ml · 3 PM", "✓ Milk3:05 PM"]);
      expect(parseFloat(spans[0].style.top)).toBe(0);
      expect(parseFloat(spans[1].style.top)).toBeCloseTo(22 - (5 / 60) * 64);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no mark for a task that was finished on another day", () => {
    const yesterdayNoon = new Date(`${Y}T12:00:00`).getTime();
    saveTodos([todo("Old", { completed: true, doneAt: yesterdayNoon })], T);
    render(<TodosPage />);
    expect(screen.queryAllByTestId("day-mark")).toHaveLength(0);
  });
});

describe("deadlines", () => {
  const tray = () => within(screen.getByRole("region", { name: "Deadlines" }));
  const dayAfter = shiftDate(T, 2);

  it("sets a deadline from the options, or the shorthand, and clears the box", async () => {
    render(<TodosPage />);
    fireEvent.change(screen.getByPlaceholderText(/What needs to be done/), { target: { value: "Tax" } });
    fireEvent.click(screen.getByText("⋯ Options"));
    fireEvent.change(screen.getByLabelText("Deadline (optional)"), { target: { value: dayAfter } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(loadTodos(T)[0]?.due).toBe(dayAfter));
    expect((screen.getByLabelText("Deadline (optional)") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByPlaceholderText(/What needs to be done/), { target: { value: "Bills by tomorrow" } });
    expect(within(screen.getByTestId("quick-add-preview")).getByText(/🏁 Due/)).toBeTruthy();
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(loadTodos(T).find((t) => t.text === "Bills")?.due).toBe(shiftDate(T, 1)));
  });

  it("doesn't take a deadline for a repeating task", async () => {
    render(<TodosPage />);
    fireEvent.click(screen.getByText("⋯ Options"));
    fireEvent.click(screen.getByText(/Repeat$/));
    expect((screen.getByLabelText("Deadline (optional)") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/What needs to be done/), { target: { value: "Gym daily by fri" } });
    expect(screen.queryByText(/🏁 Due/)).toBeNull();
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(loadTodos(T)).toHaveLength(1));
    expect(loadTodos(T)[0].due).toBeUndefined();
    expect(inItem("Gym").queryByText("+ Due")).toBeNull();
  });

  it("sets, changes and removes one on a task", async () => {
    saveTodos([todo("Tax")], T);
    render(<TodosPage />);
    await screen.findByText("Tax", { selector: "p" });
    fireEvent.click(inItem("Tax").getByText("+ Due"));
    fireEvent.change(screen.getByLabelText("Deadline for “Tax”"), { target: { value: shiftDate(T, 1) } });
    expect(loadTodos(T)[0].due).toBe(shiftDate(T, 1));
    expect(inItem("Tax").getByText("🏁 Due tomorrow")).toBeTruthy();
    fireEvent.click(screen.getByText("Remove deadline"));
    expect(loadTodos(T)[0].due).toBeUndefined();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByLabelText("Deadline for “Tax”")).toBeNull();
  });

  it("warns on a task planned after its deadline, and when moving one past it", async () => {
    const later = shiftDate(T, 3);
    saveTodos([todo("Late plan", { due: shiftDate(T, 1) })], later);
    saveTodos([todo("Tax", { due: shiftDate(T, 1) })], T);
    render(<TodosPage />);
    await screen.findByText("Tax", { selector: "p" });
    fireEvent.click(inItem("Tax").getByLabelText("Move or copy to another day"));
    fireEvent.change(screen.getByLabelText("Day to move or copy to"), { target: { value: later } });
    fireEvent.click(screen.getByText("Move"));
    expect(await flashed(/past its .* deadline/)).toBeTruthy();
    expect(loadTodos(later).find((t) => t.id === "Tax")?.due).toBe(shiftDate(T, 1));
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: later } });
    expect(await screen.findAllByText(/planned after it/)).toHaveLength(2);
  });

  it("shows a done task's deadline quietly", async () => {
    saveTodos([todo("Tax", { due: shiftDate(T, -5), completed: true })], T);
    render(<TodosPage />);
    await screen.findByText("Tax", { selector: "p" });
    expect(inItem("Tax").getByText(/^🏁 Due /)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Deadlines" })).toBeNull();
  });

  it("lists coming deadlines on today's view, from any day, and acts on them", async () => {
    saveTodos([todo("Soon", { due: shiftDate(T, 1) })], shiftDate(T, 2));
    saveTodos([todo("Today one", { due: T })], T);
    saveTodos([todo("Missed", { due: shiftDate(T, -2) })], shiftDate(T, -3));
    render(<TodosPage />);
    await screen.findByRole("region", { name: "Deadlines" });
    expect(tray().getByText("3 deadlines coming up")).toBeTruthy();
    // Closed, it shows only how soon the first one is.
    expect(tray().getByText("2 days late")).toBeTruthy();
    expect(tray().queryByText("Due today")).toBeNull();
    fireEvent.click(tray().getByRole("button", { name: /coming up/, expanded: false }));
    expect(tray().getByText("2 days late")).toBeTruthy();
    expect(tray().getByText("Due today")).toBeTruthy();
    expect(tray().getByText("Due tomorrow")).toBeTruthy();
    // It's in this tray, so not in Overdue as well.
    expect(screen.queryByText(/overdue task/)).toBeNull();

    fireEvent.click(tray().getByLabelText("Move “Soon” to today"));
    expect(loadTodos(T).some((t) => t.id === "Soon")).toBe(true);
    expect(loadTodos(T).find((t) => t.id === "Soon")?.due).toBe(shiftDate(T, 1));
    expect(await flashed("Moved to today")).toBeTruthy();

    fireEvent.click(tray().getByLabelText("Mark “Missed” as done"));
    expect(loadTodos(shiftDate(T, -3))[0].completed).toBe(true);
    expect(tray().queryByText("Missed")).toBeNull();

    expect(tray().getByText("2 deadlines coming up")).toBeTruthy();
  });

  it("says when there's one, and opens the day it's planned on", async () => {
    const planned = shiftDate(T, 4);
    saveTodos([todo("Soon", { due: shiftDate(T, 6) })], planned);
    render(<TodosPage />);
    await screen.findByRole("region", { name: "Deadlines" });
    expect(tray().getByText("1 deadline coming up")).toBeTruthy();
    fireEvent.click(tray().getByRole("button", { name: /coming up/ }));
    fireEvent.click(tray().getByText(/^Planned /));
    expect(await screen.findByText("Soon", { selector: "p" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Deadlines" })).toBeNull();
  });

  it("marks a far-off deadline on a task still in Overdue", async () => {
    saveTodos([todo("Slow", { due: shiftDate(T, 30) })], Y);
    render(<TodosPage />);
    fireEvent.click(await screen.findByText(/1 overdue task/));
    expect(screen.getByText(/^Due /)).toBeTruthy();
  });
});

describe("goals on tasks", () => {
  it("links a new task from the options, and offers goals on each task", async () => {
    addGoal("Run 10K");
    const goalId = loadGoals()[0].id;
    addGoal("Old aim");
    setGoalDone(loadGoals()[1].id, true);
    saveTodos([todo("Stretch")], T);
    render(<TodosPage />);
    await screen.findByText("Stretch", { selector: "p" });
    fireEvent.click(screen.getByText("⋯ Options"));
    const options = screen.getAllByLabelText("Goal");
    expect(within(options[0]).queryByText("Old aim")).toBeNull();
    fireEvent.change(options[0], { target: { value: goalId } });
    fireEvent.change(screen.getByPlaceholderText(/What needs to be done/), { target: { value: "Buy shoes" } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() => expect(loadTodos(T).find((t) => t.text === "Buy shoes")?.goalId).toBe(goalId));
    expect(inItem("Buy shoes").getByText(/🎯 Run 10K/)).toBeTruthy();

    fireEvent.change(inItem("Stretch").getByLabelText("Goal"), { target: { value: goalId } });
    expect(loadTodos(T).find((t) => t.id === "Stretch")?.goalId).toBe(goalId);
    fireEvent.change(inItem("Stretch").getByLabelText("Goal"), { target: { value: "" } });
    expect(loadTodos(T).find((t) => t.id === "Stretch")?.goalId).toBeUndefined();
  });

  it("offers nothing without goals, and still names an achieved goal on its task", async () => {
    saveTodos([todo("Plain")], T);
    const { unmount } = render(<TodosPage />);
    await screen.findByText("Plain", { selector: "p" });
    expect(screen.queryByLabelText("Goal")).toBeNull();
    unmount();
    addGoal("Old aim");
    const goal = loadGoals()[0];
    setGoalDone(goal.id, true);
    saveTodos([todo("Linked", { goalId: goal.id }), todo("Plain")], T);
    render(<TodosPage />);
    await screen.findByText("Linked", { selector: "p" });
    expect(inItem("Linked").getByText(/🎯 Old aim/)).toBeTruthy();
    expect(inItem("Plain").queryByLabelText("Goal")).toBeNull();
  });

  it("imports goals with the rest of a backup", async () => {
    render(<TodosPage />);
    const file = new File([JSON.stringify({ app: "planner", days: {}, settings: { goals: [{ id: "a", name: "Run" }, { id: "b", name: "Read" }] } })], "p.json");
    fireEvent.change(document.getElementById("import-file")!, { target: { files: [file] } });
    expect(await flashed(/\+ 2 goals/)).toBeTruthy();
    const one = new File([JSON.stringify({ app: "planner", days: {}, settings: { goals: [{ id: "a", name: "Run" }] } })], "p.json");
    fireEvent.change(document.getElementById("import-file")!, { target: { files: [one] } });
    expect(await flashed(/\+ 1 goal$/)).toBeTruthy();
  });
});

describe("links to a day and to search", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("opens the day named in the address, then forgets it", async () => {
    const day = shiftDate(T, -40);
    saveTodos([todo("Long ago")], day);
    window.history.replaceState(null, "", `/todos?date=${day}`);
    render(<TodosPage />);
    expect(await screen.findByText("Long ago", { selector: "p" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("ignores a date that isn't one", async () => {
    saveTodos([todo("Now")], T);
    window.history.replaceState(null, "", "/todos?date=soon");
    render(<TodosPage />);
    expect(await screen.findByText("Now", { selector: "p" })).toBeTruthy();
    window.history.replaceState(null, "", "/todos?date=2026-99-99");
    render(<TodosPage />);
    expect((await screen.findAllByText("Now", { selector: "p" })).length).toBeGreaterThan(0);
  });

  it("links to Search and Goals, and offers every day when the day's filter finds nothing", async () => {
    saveTodos([todo("Gym")], T);
    render(<TodosPage />);
    await screen.findByText("Gym", { selector: "p" });
    expect(screen.getByText("Search →").getAttribute("href")).toBe("/todos/search");
    expect(screen.getByText("Goals →").getAttribute("href")).toBe("/todos/goals");
    fireEvent.change(screen.getByPlaceholderText("Filter this day"), { target: { value: "den tist" } });
    expect(screen.getByText("Search every day →").getAttribute("href")).toBe("/todos/search?q=den%20tist");
  });
});
