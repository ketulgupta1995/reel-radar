// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { jsonResponse } from "@/test/fixtures";
import { requests, routeFetch } from "@/test/pages";
import { addItem, addList, loadItems } from "@/lib/lists";
import { addGoal, loadGoals } from "@/lib/plannerSettings";
import { getFocusSession, loadDayLog, loadTodos, saveTodos, updateDayLog, type Todo } from "@/lib/todos";

vi.mock("next/navigation", () => ({ usePathname: () => "/planner-next" }));

import PlannerNextPage from "./page";

// Sunday 8 November 2026, 9:40 am.
const T = "2026-11-08";
const Y = "2026-11-07";
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-11-01T00:00:00.000Z", ...extra });
const at = (h: number, m = 0) => vi.setSystemTime(new Date(2026, 10, 8, h, m));
const open = () => render(<PlannerNextPage />);
const tasks = () => within(screen.getByRole("list", { name: "Tasks" }));
const tiles = () => within(screen.getByRole("group", { name: "Log items" }));
const flashed = (text: string | RegExp) => screen.findByText(text);
const add = (text: string) => {
  fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: text } });
  fireEvent.submit(screen.getByLabelText("Add a task"));
};

let fetchMock: ReturnType<typeof routeFetch>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(9, 40);
  fetchMock = routeFetch();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("header and days", () => {
  it("opens on today, and moves between days by button and key", async () => {
    saveTodos([todo("Today's task")], T);
    saveTodos([todo("Yesterday's task")], Y);
    open();
    expect(await screen.findByText("8 Nov")).toBeTruthy();
    expect(screen.getByText("Sun · Today")).toBeTruthy();
    expect(tasks().getByText("Today's task")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous day"));
    expect(await screen.findByText("Yesterday's task")).toBeTruthy();
    expect(screen.getByText("Sat · Yesterday")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Go to today"));
    expect(await tasks().findByText("Today's task")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByText("Mon · Tomorrow")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(await screen.findByText("Tue")).toBeTruthy();
    expect(screen.getByText("10 Nov")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "t" });
    expect(await screen.findByText("Sun · Today")).toBeTruthy();
    // Keys typed into a field are text, not shortcuts.
    fireEvent.keyDown(screen.getByLabelText("Add a task"), { key: "ArrowLeft" });
    expect(screen.getByText("Sun · Today")).toBeTruthy();
  });

  it("syncs on request, and says when it can't", async () => {
    open();
    fireEvent.click(await screen.findByLabelText("Sync now"));
    expect(await screen.findByLabelText("Synced")).toBeTruthy();
    fetchMock.mockImplementation(async () => {
      throw new Error("offline");
    });
    await waitFor(() => expect(screen.getByLabelText("Sync now")).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByLabelText("Sync now"));
    expect(await screen.findByLabelText("Sync failed, try again")).toBeTruthy();
  });

  it("has four tabs, and marks a review due on Sunday", async () => {
    open();
    const bar = within(screen.getByRole("navigation", { name: "Planner tabs" }));
    expect(await bar.findByLabelText("Weekly review is ready")).toBeTruthy();
    fireEvent.click(bar.getByText("Plans"));
    expect(screen.getByRole("group", { name: "Plans view" })).toBeTruthy();
    expect(screen.queryByLabelText("Previous day")).toBeNull();
    fireEvent.click(bar.getByText("Calendar"));
    expect(screen.getByRole("group", { name: "Calendar view" })).toBeTruthy();
    fireEvent.click(bar.getByText("More"));
    expect(screen.getByRole("button", { name: /Stats/ })).toBeTruthy();
    fireEvent.click(bar.getByText("Today"));
    expect(screen.getByLabelText("Add a task")).toBeTruthy();
    expect(bar.getByText("Today").getAttribute("aria-current")).toBe("page");
  });

  it("shows the year for a day in another one", async () => {
    vi.setSystemTime(new Date(2026, 11, 31, 9, 0));
    open();
    fireEvent.click(await screen.findByLabelText("Next day"));
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(await screen.findByText("2 Jan 2027")).toBeTruthy();
  });

  it("shows no review dot once the week is reviewed, or on another weekday", async () => {
    updateDayLog(T, { reviewedAt: 1 });
    open();
    await screen.findByText("8 Nov");
    expect(screen.queryByLabelText("Weekly review is ready")).toBeNull();
  });
});

describe("the card at the top", () => {
  const day = () => [
    todo("Gym", { start: 420, duration: 45, completed: true, doneAt: new Date(2026, 10, 8, 7, 50).getTime() }),
    todo("Report", { start: 570, duration: 90, tag: "work" }),
    todo("Call", { start: 720, duration: 15 }),
    todo("Dentist"),
  ];

  it("counts down the block under way, and finishes it", async () => {
    saveTodos(day(), T);
    open();
    const card = within(await screen.findByRole("region", { name: "Under way" }));
    expect(card.getByText("Report")).toBeTruthy();
    expect(card.getByText("1:20:00")).toBeTruthy();
    expect(card.getByText("left · ends 11 AM")).toBeTruthy();
    expect(screen.getByText("1 of 4 done")).toBeTruthy();
    expect(screen.getByText("45m of 2h 30m planned")).toBeTruthy();
    fireEvent.click(card.getByText("Finish"));
    expect(loadTodos(T).find((t) => t.id === "Report")!.completed).toBe(true);
    expect(await screen.findByRole("region", { name: "Free time" })).toBeTruthy();
    expect(screen.getByText("Free until 12 PM")).toBeTruthy();
  });

  it("times a focus session, then records it, and can mark the task done", async () => {
    saveTodos(day(), T);
    open();
    fireEvent.click(within(await screen.findByRole("region", { name: "Under way" })).getByText("▶ Focus"));
    const card = within(screen.getByRole("region", { name: "Focusing" }));
    expect(getFocusSession()).toMatchObject({ todoId: "Report", date: T });
    expect(card.getByTestId("focus-clock").textContent).toBe("1:30:00");
    at(10, 5);
    fireEvent.click(card.getByText("Stop"));
    expect(await flashed("Recorded 25m on “Report”")).toBeTruthy();
    expect(loadTodos(T).find((t) => t.id === "Report")).toMatchObject({ spent: 25, completed: false });
    // From a task's row, then finished from the card. Under a minute records nothing.
    fireEvent.click(tasks().getByLabelText("Focus on “Dentist”"));
    expect(screen.getByText("spent so far")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Focusing" })).getByText("Finish"));
    expect(await flashed("Under a minute, so nothing was recorded")).toBeTruthy();
    expect(loadTodos(T).find((t) => t.id === "Dentist")!.completed).toBe(true);
    expect(getFocusSession()).toBeNull();
  });

  it("between blocks, offers unscheduled tasks to start", async () => {
    at(11, 15);
    saveTodos(day(), T);
    open();
    const card = within(await screen.findByRole("region", { name: "Free time" }));
    expect(card.getByText("45m · then Call")).toBeTruthy();
    fireEvent.click(card.getByLabelText("Start “Dentist”"));
    expect(getFocusSession()).toMatchObject({ todoId: "Dentist" });
  });

  it("after the last block asks to wrap up, and when all is done opens the day log", async () => {
    at(22, 30);
    saveTodos(day(), T);
    open();
    const wrap = within(await screen.findByRole("region", { name: "Wrap up" }));
    expect(wrap.getByText("3 still open")).toBeTruthy();
    fireEvent.click(wrap.getByText("Sleep, weight and notes"));
    expect(screen.getByLabelText("Weight in kg")).toBeTruthy();
    fireEvent.click(screen.getByText("Less"));
    expect(screen.queryByLabelText("Weight in kg")).toBeNull();

    saveTodos(day().map((t) => ({ ...t, completed: true })), T);
    fireEvent.click(screen.getByLabelText("Previous day"));
    fireEvent.click(screen.getByLabelText("Next day"));
    const done = within(await screen.findByRole("region", { name: "All done" }));
    expect(done.getByText("4 tasks done")).toBeTruthy();
    fireEvent.click(done.getByText("Fill in the day log"));
    expect(screen.getByLabelText("Weight in kg")).toBeTruthy();
  });

  it("isn't shown on another day, or on an empty one", async () => {
    saveTodos(day(), Y);
    open();
    await screen.findByText("8 Nov");
    expect(screen.queryByRole("region", { name: /Under way|Free time|Wrap up|All done/ })).toBeNull();
    expect(screen.getByText("Nothing planned yet. Add the first task above.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous day"));
    expect((await screen.findAllByText("Gym")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: /Under way|Free time/ })).toBeNull();
  });
});

describe("needs attention", () => {
  const row = () => screen.getByRole("button", { name: /attention/ });
  const attn = () => within(screen.getByRole("region", { name: "Needs attention" }));

  it("counts everything that needs a decision, red when something is late, and acts on deadlines", async () => {
    saveTodos([todo("Tax return", { due: "2026-11-06" }), todo("Card bill", { due: "2026-11-10" })], "2026-11-02");
    saveTodos([todo("Passport photo")], "2026-11-05");
    open();
    await waitFor(() => expect(row().textContent).toContain("3"));
    expect(row().textContent).toContain("1 late · need attention");
    expect(row().className).toContain("bg-bf-late");
    fireEvent.click(row());
    expect(screen.getByText("2 days late · planned Nov 2")).toBeTruthy();
    expect(screen.getByText("Due Tue · planned Nov 2")).toBeTruthy();
    expect(screen.getByText("Planned for Nov 5")).toBeTruthy();
    // Done ticks it where it's planned; Today moves it here, keeping the deadline.
    const late = within(attn().getByText("Tax return").closest("li")!);
    fireEvent.click(late.getByText("Done"));
    expect(await flashed("Done: Tax return")).toBeTruthy();
    expect(loadTodos("2026-11-02").find((t) => t.id === "Tax return")!.completed).toBe(true);
    fireEvent.click(within(attn().getByText("Card bill").closest("li")!).getByText("Today"));
    expect(await flashed("Moved to today")).toBeTruthy();
    expect(loadTodos(T).find((t) => t.id === "Card bill")!.due).toBe("2026-11-10");
    expect(row().textContent).not.toContain("late");
    // Planned today, so there's nowhere to move it.
    expect(within(attn().getByText("Card bill").closest("li")!).queryByText("Today")).toBeNull();
  });

  it("moves overdue tasks to today or drops them, with undo", async () => {
    saveTodos([todo("Bike brakes", { postponed: 3 }), todo("Renew photo"), todo("Old one")], "2026-11-05");
    open();
    await waitFor(() => expect(row().textContent).toContain("3"));
    fireEvent.click(row());
    expect(screen.getByText("Postponed 3 times. Drop it or break it down?")).toBeTruthy();
    fireEvent.click(within(attn().getByText("Renew photo").closest("li")!).getByText("Today"));
    expect(await flashed("Moved 1 task to today")).toBeTruthy();
    expect(tasks().getByText("Renew photo")).toBeTruthy();
    fireEvent.click(within(attn().getByText("Bike brakes").closest("li")!).getByText("Drop"));
    expect(await flashed("Dropped “Bike brakes”")).toBeTruthy();
    expect(loadTodos("2026-11-05").map((t) => t.id)).toEqual(["Old one"]);
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(loadTodos("2026-11-05").map((t) => t.id).sort()).toEqual(["Bike brakes", "Old one"]));
    fireEvent.click(screen.getByText("All to today"));
    expect(await flashed("Moved 2 tasks to today")).toBeTruthy();
    expect(loadTodos("2026-11-05")).toEqual([]);
    expect(screen.queryByRole("button", { name: /attention/ })).toBeNull();
  });

  it("on another day, offers the day before's unfinished tasks", async () => {
    saveTodos([todo("Groceries"), todo("Laundry"), todo("Done one", { completed: true })], "2026-11-09");
    open();
    fireEvent.click(await screen.findByLabelText("Next day"));
    fireEvent.click(await screen.findByLabelText("Next day"));
    await waitFor(() => expect(row().textContent).toContain("2"));
    fireEvent.click(row());
    fireEvent.click(within(screen.getByText("Groceries").closest("li")!).getByText("Add"));
    expect(await flashed("Added 1 task from the day before")).toBeTruthy();
    expect(loadTodos("2026-11-10").map((t) => t.id)).toEqual(["Groceries"]);
    fireEvent.click(screen.getByText("Add all"));
    expect(await flashed("Added 1 task from the day before")).toBeTruthy();
    expect(loadTodos("2026-11-09").map((t) => t.id)).toEqual(["Done one"]);
  });

  it("lists a goal with no next step, and adding a step links it to the goal", async () => {
    addGoal("Run a 10K");
    addGoal("Read more");
    const read = loadGoals().find((g) => g.name === "Read more")!;
    saveTodos([todo("Read 20 pages", { goalId: read.id })], T);
    open();
    await waitFor(() => expect(row().textContent).toContain("1"));
    fireEvent.click(row());
    expect(screen.getByText("Run a 10K")).toBeTruthy();
    expect(screen.queryByText("Read more")).toBeNull();
    fireEvent.click(screen.getByText("Add a step"));
    expect(document.activeElement).toBe(screen.getByLabelText("Add a task"));
    add("Buy running shoes");
    expect(await flashed("Added a step for Run a 10K")).toBeTruthy();
    const goal = loadGoals().find((g) => g.name === "Run a 10K")!;
    expect(loadTodos(T).find((t) => t.text === "Buy running shoes")!.goalId).toBe(goal.id);
    await waitFor(() => expect(screen.queryByRole("button", { name: /attention/ })).toBeNull());
  });
});

describe("day log", () => {
  it("ticks items in one tap, takes steps, and adds water", async () => {
    open();
    expect(await screen.findByLabelText("0 of 7 logged")).toBeTruthy();
    fireEvent.click(tiles().getByRole("button", { name: /Bath/ }));
    expect(loadDayLog(T).ticks).toEqual({ bath: { at: 580 } });
    expect(tiles().getByRole("button", { name: /Bath/ }).textContent).toContain("9:40 AM");
    fireEvent.click(tiles().getByRole("button", { name: /Walk/ }));
    fireEvent.change(tiles().getByLabelText("Walk, steps"), { target: { value: "3,240" } });
    fireEvent.keyDown(tiles().getByLabelText("Walk, steps"), { key: "Enter" });
    expect(loadDayLog(T).counts).toEqual({ walk: 3240 });
    expect(tiles().getByRole("button", { name: /3,240/ })).toBeTruthy();
    expect(screen.getByLabelText("2 of 7 logged")).toBeTruthy();
    // Escape leaves it; blurring an empty box clears it.
    fireEvent.click(tiles().getByRole("button", { name: /3,240/ }));
    fireEvent.keyDown(tiles().getByLabelText("Walk, steps"), { key: "Escape" });
    expect(loadDayLog(T).counts).toEqual({ walk: 3240 });
    fireEvent.click(tiles().getByRole("button", { name: /3,240/ }));
    fireEvent.change(tiles().getByLabelText("Walk, steps"), { target: { value: "" } });
    fireEvent.blur(tiles().getByLabelText("Walk, steps"));
    expect(loadDayLog(T).counts).toBeUndefined();
    fireEvent.click(tiles().getByRole("button", { name: /Bath/ }));
    expect(loadDayLog(T).ticks).toBeUndefined();
    fireEvent.click(tiles().getByLabelText("More water"));
    expect(loadDayLog(T)).toEqual({ water: 250, drinks: [{ at: 580, ml: 250 }] });
    expect(tiles().getByLabelText("More water").textContent).toContain("0.25 L / 2.5 L");
  });

  it("keeps no time for ticks or drinks logged for another day", async () => {
    open();
    fireEvent.click(await screen.findByLabelText("Previous day"));
    await waitFor(() => expect(screen.getByText("Sat · Yesterday")).toBeTruthy());
    fireEvent.click(tiles().getByRole("button", { name: /Yoga/ }));
    fireEvent.click(tiles().getByLabelText("More water"));
    expect(loadDayLog(Y)).toEqual({ ticks: { yoga: {} }, water: 250 });
    expect(tiles().getByRole("button", { name: /Yoga/ }).textContent).toContain("done");
    fireEvent.click(screen.getByText("Sleep, weight, notes"));
    fireEvent.click(screen.getByLabelText("Add a bottle"));
    expect(loadDayLog(Y).drinks).toBeUndefined();
  });

  it("opens sleep, weight, water and notes, and shows when items were ticked", async () => {
    updateDayLog(T, { ticks: { med1: { at: 495 } }, weight: 71.4 });
    open();
    fireEvent.click(await screen.findByText("Sleep, weight, notes"));
    expect(screen.getByText("Ticked: Med 1 8:15 AM")).toBeTruthy();
    expect((screen.getByLabelText("Weight in kg") as HTMLInputElement).value).toBe("71.4");
    fireEvent.click(screen.getByRole("button", { name: "Woke up: not set" }));
    fireEvent.click(screen.getByLabelText("6 o'clock"));
    fireEvent.click(screen.getByLabelText("45 minutes"));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Done"));
    expect(loadDayLog(T).wake).toBe("06:45");
    fireEvent.change(screen.getByLabelText("Weight in kg"), { target: { value: "" } });
    expect(loadDayLog(T).weight).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Weight in kg"), { target: { value: "70.9" } });
    fireEvent.click(screen.getByLabelText("Add a bottle"));
    fireEvent.click(screen.getByLabelText("Less water"));
    expect(screen.getByTestId("water-total").textContent).toBe("0.25 L");
    fireEvent.change(screen.getByLabelText("What went well"), { target: { value: "Shipped it" } });
    fireEvent.change(screen.getByLabelText("What went badly"), { target: { value: "Late lunch" } });
    fireEvent.change(screen.getByLabelText("What to improve"), { target: { value: "Plan breaks" } });
    expect(loadDayLog(T)).toMatchObject({ wake: "06:45", weight: 70.9, water: 250, well: "Shipped it", bad: "Late lunch", improve: "Plan breaks", ticks: { med1: { at: 495 } } });
  });
});

describe("adding", () => {
  it("reads the shorthand, shows what it set, and schedules the task", async () => {
    open();
    const input = await screen.findByLabelText("Add a task");
    expect(screen.getByTestId("quick-add-preview").textContent).toContain("6pm · 45m");
    fireEvent.change(input, { target: { value: "Gym 6pm 45m #health !high" } });
    const preview = screen.getByTestId("quick-add-preview").textContent!;
    expect(preview).toContain("⏰ 6 PM · 45m");
    expect(preview).toContain("# Health");
    expect(preview).toContain("⚑ High");
    fireEvent.submit(input);
    expect(loadTodos(T)[0]).toMatchObject({ text: "Gym", start: 1080, duration: 45, tag: "health", priority: "high" });
    expect(tasks().getByText("Gym")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    fireEvent.submit(input); // nothing typed: nothing added
    expect(loadTodos(T)).toHaveLength(1);
  });

  it("adds to another day, a repeat, and a monthly repeat that starts later", async () => {
    open();
    await screen.findByLabelText("Add a task");
    add("Dentist tomorrow");
    expect(await flashed("Added to Mon, Nov 9")).toBeTruthy();
    expect(loadTodos("2026-11-09")[0].text).toBe("Dentist");
    add("Stretch daily");
    await waitFor(() => expect(tasks().getByText("Stretch")).toBeTruthy());
    expect(loadTodos(T).find((t) => t.text === "Stretch")!.dailyId).toBeTruthy();
    add("Pay rent on the 1st");
    expect(await flashed(/Nothing to do until then/)).toBeTruthy();
  });

  it("sends an entry to a list, reading a price and link", async () => {
    const list = addList("Wishlist", "🎧");
    open();
    const where = await screen.findByLabelText("Add to");
    await waitFor(() => expect(within(where).getByText("List · 🎧 Wishlist")).toBeTruthy());
    fireEvent.change(where, { target: { value: `list:${list.id}` } });
    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Headphones ₹2,999 amazon.in/x" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toBe("₹2,999 · 🔗 link");
    fireEvent.submit(screen.getByLabelText("Add a task"));
    expect(await flashed("Added to Wishlist")).toBeTruthy();
    expect(loadItems(list.id)[0]).toMatchObject({ text: "Headphones", price: 2999, link: "https://amazon.in/x" });
    expect(loadTodos(T)).toEqual([]);
    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Socks amazon.in/s" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toBe("🔗 link");
    fireEvent.change(screen.getByLabelText("Add a task"), { target: { value: "Scarf ₹900" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toBe("₹900");
    fireEvent.change(where, { target: { value: "day" } });
    expect(screen.getByTestId("quick-add-preview").textContent).toBe("");
  });

  it("N or / jumps to the add box", async () => {
    open();
    const input = await screen.findByLabelText("Add a task");
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "n" });
    expect(document.activeElement).toBe(input);
    input.blur();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true }); // not a shortcut
  });
});

describe("tasks", () => {
  it("lists blocks in time order with their details, and moves finished ones to Done with when", async () => {
    addGoal("Q4 launch");
    const goal = loadGoals()[0];
    saveTodos(
      [
        todo("Unscheduled", { priority: "low" }),
        todo("Late", { start: 900, tag: "home", due: "2026-11-07", priority: "medium" }),
        todo("Early", { start: 480, duration: 30, priority: "high", goalId: goal.id, due: T, subtasks: [{ id: "s", text: "s", done: true }, { id: "u", text: "u", done: false }] }),
        todo("Done any", { completed: true, doneAt: new Date(2026, 10, 8, 9, 5).getTime() }),
        todo("Done block", { completed: true, start: 420, tag: "health", doneAt: new Date(2026, 10, 8, 7, 50).getTime() }),
        todo("Due later", { due: "2026-11-20" }),
      ],
      T
    );
    open();
    await tasks().findByText("Early");
    expect(tasks().getAllByRole("listitem").map((li) => li.querySelector("span.break-words")!.textContent)).toEqual(["Early", "Late", "Unscheduled", "Due later"]);
    const early = within(tasks().getByText("Early").closest("li")!);
    expect(early.getByText("8:00")).toBeTruthy();
    for (const m of ["30m", "⚑ High", "🏁 today", "◎ Q4 launch", "☑ 1/2"]) expect(early.getByText(m)).toBeTruthy();
    expect(within(tasks().getByText("Late").closest("li")!).getByText("🏁 Nov 7").className).toContain("text-bf-late");
    expect(within(tasks().getByText("Late").closest("li")!).getByText("⚑ Medium")).toBeTruthy();
    expect(within(tasks().getByText("Due later").closest("li")!).getByText("🏁 Nov 20").className).not.toContain("text-bf-late");
    expect(within(tasks().getByText("Unscheduled").closest("li")!).getByText("Any")).toBeTruthy();
    const done = within(screen.getByRole("list", { name: "Done" }));
    expect(done.getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("✓ 7:50"), expect.stringContaining("✓ 9:05")]);
    expect(screen.getByText("Done · 2")).toBeTruthy();
    fireEvent.click(screen.getByText("Done · 2"));
    expect(screen.queryByRole("list", { name: "Done" })).toBeNull();
    fireEvent.click(screen.getByText("Done · 2"));

    fireEvent.click(tasks().getByLabelText("Mark “Early” done"));
    expect(loadTodos(T).find((t) => t.id === "Early")!.completed).toBe(true);
    await waitFor(() => expect(screen.getByText("Done · 3")).toBeTruthy());
    fireEvent.click(within(screen.getByRole("list", { name: "Done" })).getByLabelText("Mark “Done any” not done"));
    expect(loadTodos(T).find((t) => t.id === "Done any")!.completed).toBe(false);
  });

  it("shows a repeating task's streak", async () => {
    open();
    await screen.findByLabelText("Add a task");
    add("Meditate daily");
    await waitFor(() => expect(tasks().getByText("Meditate")).toBeTruthy());
    fireEvent.click(tasks().getByLabelText("Mark “Meditate” done"));
    await waitFor(() => expect(screen.getByText("🔥 1")).toBeTruthy());
  });

  it("picks up edits made on another device", async () => {
    open();
    await screen.findByLabelText("Add a task");
    act(() => {
      saveTodos([todo("From the phone")], T);
      window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: ["planner-2026-11"] } }));
    });
    expect(await tasks().findByText("From the phone")).toBeTruthy();
  });
});

describe("messages", () => {
  it("can be dismissed", async () => {
    saveTodos([todo("Old", {})], "2026-11-01");
    open();
    fireEvent.click(await screen.findByRole("button", { name: /attention/ }));
    fireEvent.click(screen.getByText("All to today"));
    await flashed("Moved 1 task to today");
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText("Moved 1 task to today")).toBeNull();
  });
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

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static sent: { title: string; body?: string }[] = [];
  constructor(title: string, opts?: { body?: string }) {
    FakeNotification.sent.push({ title, body: opts?.body });
  }
}
const resetNotifications = () => {
  FakeNotification.permission = "granted";
  FakeNotification.sent = [];
};

// jsdom has no DragEvent: give the event what the drop handlers read.
const dragTo = (kind: "dragOver" | "drop", el: HTMLElement, id: string, at: { clientX?: number; clientY?: number }) => {
  const event = createEvent[kind](el, { dataTransfer: { getData: (k: string) => (k === "text/todo-id" ? id : ""), setData: () => {} } });
  for (const [k, v] of Object.entries(at)) Object.defineProperty(event, k, { value: v });
  fireEvent(event.target === el ? el : el, event);
};
const box = (el: HTMLElement, r: Partial<DOMRect>) => {
  el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0, ...r }) as DOMRect;
};

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


// A drag from the week, with what its drop handler reads, and modifier keys or a position if given.
const weekDrag = (kind: "dragOver" | "drop", el: Element, id: string, from: string, extra: Record<string, unknown> = {}) => {
  const event = createEvent[kind](el, { dataTransfer: { getData: (k: string) => (k === "text/todo-id" ? id : k === "text/todo-date" ? from : ""), dropEffect: "" } });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(event, k, { value: v });
  fireEvent(el, event);
};

describe("calendar", () => {
  const openCalendar = async () => {
    open();
    fireEvent.click(within(await screen.findByRole("navigation", { name: "Planner tabs" })).getByText("Calendar"));
  };
  const row = (date: string) => document.querySelector<HTMLElement>(`[data-day='${date}']`)!;

  it("shows the week as a row a day on a phone, opens a day, and steps by week", async () => {
    saveTodos([todo("Gym", { start: 420, completed: true }), todo("Report", { start: 570, tag: "work" }), todo("Loose")], T);
    saveTodos([todo("Missed", { start: 600 })], "2026-11-03");
    await openCalendar();
    expect(await screen.findByText("Nov 2 – Nov 8")).toBeTruthy();
    expect(screen.getAllByText("1/4 done · 3h planned").length).toBeGreaterThan(0);
    expect(within(row(T)).getByText("1/3")).toBeTruthy();
    expect(within(row(T)).getByText("+1 any time")).toBeTruthy();
    expect(row("2026-11-03").querySelector("[title^='Missed']")!.className).toContain("opacity-35"); // not done, day gone
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(await screen.findByText("Nov 9 – Nov 15")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous week"));
    fireEvent.click(within(row("2026-11-03")).getByLabelText(/^Open /));
    expect(await screen.findByText("Tue")).toBeTruthy();
    expect(screen.getByText("3 Nov")).toBeTruthy();
    expect(screen.getByLabelText("Add a task")).toBeTruthy();
  });

  it("moves a dragged block to another day at the same time, or copies it with Ctrl", async () => {
    saveTodos([todo("Report", { start: 570, duration: 90 }), todo("Daily", { dailyId: "d1", start: 420 })], T);
    await openCalendar();
    await screen.findByText("Nov 2 – Nov 8");
    const block = row(T).querySelector<HTMLElement>("[title^='Report']")!;
    const setData = vi.fn();
    fireEvent(block, createEvent.dragStart(block, { dataTransfer: { setData } }));
    expect(setData).toHaveBeenCalledWith("text/todo-date", T);
    weekDrag("dragOver", row("2026-11-05"), "Report", T, { ctrlKey: true });
    expect(row("2026-11-05").className).toContain("ring-gold");
    fireEvent.dragLeave(row("2026-11-05"));
    weekDrag("drop", row("2026-11-05"), "Report", T, { ctrlKey: true });
    expect(await flashed("Copied to Thu, Nov 5, 2026")).toBeTruthy();
    expect(loadTodos("2026-11-05")[0]).toMatchObject({ text: "Report", start: 570 });
    weekDrag("drop", row("2026-11-04"), "Report", T);
    expect(await flashed("Moved to Wed, Nov 4, 2026")).toBeTruthy();
    expect(loadTodos("2026-11-04")[0]).toMatchObject({ text: "Report", start: 570, duration: 90 });
    expect(loadTodos(T).map((t) => t.id)).toEqual(["Daily"]);
    weekDrag("drop", row("2026-11-04"), "Daily", T);
    expect(await flashed(/Repeating tasks stay on their own day/)).toBeTruthy();
    weekDrag("drop", row("2026-11-04"), "gone", T); // nothing to move
    expect(loadTodos("2026-11-04")).toHaveLength(1);
  });

  it("shows seven columns on a laptop: drop at a time, into To do, resize, tick and open", async () => {
    saveTodos([todo("Report", { start: 570, duration: 60 }), ...["A", "B", "C", "D", "E"].map((x) => todo(x))], T);
    await openCalendar();
    await screen.findByText("Nov 2 – Nov 8");
    const column = document.querySelector<HTMLElement>(`[data-day-column='2026-11-06']`)!;
    column.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    weekDrag("dragOver", column, "Report", T, { clientY: 64 * 14 });
    expect(within(column).getByText("2 PM")).toBeTruthy();
    weekDrag("dragOver", column, "Report", T, { clientY: 64 * 14, altKey: true });
    expect(within(column).getByText(/Copy ·/)).toBeTruthy();
    fireEvent.dragLeave(column);
    weekDrag("drop", column, "Report", T, { clientY: 64 * 14 });
    expect(loadTodos("2026-11-06")[0]).toMatchObject({ text: "Report", start: 840 });
    const strip = document.querySelector<HTMLElement>(`[data-todo-strip='2026-11-07']`)!;
    weekDrag("dragOver", strip, "Report", "2026-11-06");
    fireEvent.dragLeave(strip);
    weekDrag("drop", strip, "Report", "2026-11-06");
    expect(loadTodos("2026-11-07")[0].start).toBeUndefined();
    // Today's To do strip shows four, then a count that opens the day.
    const todayStrip = document.querySelector<HTMLElement>(`[data-todo-strip='${T}']`)!;
    expect(within(todayStrip).getAllByText(/^[A-E]$/)).toHaveLength(4);
    const chip = within(todayStrip).getByText("A");
    const setData = vi.fn();
    fireEvent(chip, createEvent.dragStart(chip, { dataTransfer: { setData } }));
    expect(setData).toHaveBeenCalledWith("text/todo-id", "A");

    saveTodos([todo("Block", { start: 600, duration: 60 })], "2026-11-05");
    fireEvent.click(screen.getByLabelText("Next week"));
    fireEvent.click(screen.getByLabelText("Previous week"));
    const block = await waitFor(() => document.querySelector<HTMLElement>("[data-block='Block']")!);
    fireEvent.click(within(block).getByLabelText("Mark “Block” done"));
    expect(loadTodos("2026-11-05")[0].completed).toBe(true);
    act(() => void within(block).getByTestId("resize-handle").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientY: 0 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: 32 })));
    expect(within(block).getByText("10 AM – 11:30 AM")).toBeTruthy();
    fireEvent(block, createEvent.dragStart(block, { dataTransfer: { setData: vi.fn() } }));
    act(() => void window.dispatchEvent(new MouseEvent("pointerup")));
    expect(loadTodos("2026-11-05")[0].duration).toBe(90);
    fireEvent.click(within(document.querySelector<HTMLElement>(`[data-todo-strip='${T}']`)!).getByText("+1 more")); // drawn afresh after the week changed
    expect(await screen.findByText("Sun · Today")).toBeTruthy();
  });

  it("opens a day from a column's header, a block or a chip", async () => {
    saveTodos([todo("Block", { start: 600 }), todo("Chip")], "2026-11-04");
    await openCalendar();
    const header = (await screen.findAllByLabelText("Open Wed, Nov 4, 2026")).find((b) => b.className.includes("rounded-t"))!;
    fireEvent.click(header);
    expect(await screen.findByText("4 Nov")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Planner tabs" })).getByText("Calendar"));
    fireEvent.click(await waitFor(() => document.querySelector<HTMLElement>("[data-block='Block']")!));
    expect(await screen.findByText("4 Nov")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Planner tabs" })).getByText("Calendar"));
    fireEvent.click(within(await waitFor(() => document.querySelector<HTMLElement>("[data-todo-strip='2026-11-04']")!)).getByText("Chip"));
    expect(await screen.findByText("4 Nov")).toBeTruthy();
  });

  it("shows the month as a heatmap with each day's log score, and a table", async () => {
    saveTodos([todo("a", { completed: true }), todo("b", { completed: true }), todo("c")], "2026-11-03");
    saveTodos(Array.from({ length: 8 }, (_, i) => todo(`d${i}`, { completed: true })), T);
    updateDayLog("2026-11-03", { ticks: { bath: {}, brush: {} }, counts: { walk: 4000 } });
    await openCalendar();
    fireEvent.click(await screen.findByRole("button", { name: "month" }));
    expect(await screen.findByText("November 2026")).toBeTruthy();
    expect(screen.getByText("10", { selector: "div" })).toBeTruthy(); // finished this month
    expect(screen.getByText("of 30")).toBeTruthy();
    expect(screen.getByText("Nov 8", { selector: "div" })).toBeTruthy(); // best day
    const third = screen.getByLabelText("Nov 3: 2 of 3 tasks finished, log 3 of 7");
    expect(third.textContent).toContain("3/7");
    expect(third.className).toContain("bg-gold/25");
    expect(screen.getByLabelText("Nov 8: 8 of 8 tasks finished").className).toContain("bg-gold ");
    expect(screen.getByLabelText("Nov 20: nothing planned").className).toContain("opacity-60");
    expect(screen.getByText("View as table")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header, Nov 3, Nov 8
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(await screen.findByText("December 2026")).toBeTruthy();
    expect(screen.getByText("nothing finished yet")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous month"));
    fireEvent.click(await screen.findByLabelText("Nov 3: 2 of 3 tasks finished, log 3 of 7"));
    expect(await screen.findByText("3 Nov")).toBeTruthy();
  });

  it("W and M open the week and month and, again, go back; arrows step by the view", async () => {
    open();
    await screen.findByText("Sun · Today");
    fireEvent.keyDown(window, { key: "w" });
    expect(await screen.findByText("Nov 2 – Nov 8")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByText("Nov 9 – Nov 15")).toBeTruthy();
    fireEvent.keyDown(window, { key: "m" });
    expect(await screen.findByText("November 2026")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByText("December 2026")).toBeTruthy();
    fireEvent.keyDown(window, { key: "m" });
    expect(await screen.findByLabelText("Add a task")).toBeTruthy();
    fireEvent.keyDown(window, { key: "t" });
    fireEvent.keyDown(window, { key: "w" });
    fireEvent.keyDown(window, { key: "w" });
    expect(await screen.findByText("Sun · Today")).toBeTruthy();
  });
});

describe("plans", () => {
  const openPlans = async () => {
    open();
    fireEvent.click(within(await screen.findByRole("navigation", { name: "Planner tabs" })).getByText("Plans"));
  };

  it("on a Sunday, puts the weekly review on top; finishing it clears the tab's dot", async () => {
    await openPlans();
    const card = within(await screen.findByRole("region", { name: "Weekly review" }));
    expect(card.getByText("Look back on Nov 2 – Nov 8")).toBeTruthy();
    fireEvent.click(card.getByText("Start review"));
    expect(screen.getByText("Weekly review")).toBeTruthy();
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Arrange it in the week view →"));
    expect(await screen.findByText("Nov 2 – Nov 8")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Planner tabs" })).getByText("Plans"));
    fireEvent.click(screen.getByText("Next")); // back on the review, from its first step
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Finish review"));
    expect(loadDayLog(T).reviewedAt).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Back to Plans"));
    await waitFor(() => expect(screen.queryByLabelText("Weekly review is ready")).toBeNull());
    expect(screen.queryByRole("region", { name: "Weekly review" })).toBeNull();
    fireEvent.click(screen.getByText("Weekly review →")); // any day, from the link
    fireEvent.click(screen.getByText("‹ Plans"));
    expect(screen.getByRole("group", { name: "Plans view" })).toBeTruthy();
  });

  it("switches between goals and lists, and a goal's next step opens its day", async () => {
    addGoal("Run");
    saveTodos([todo("Shoes", { goalId: loadGoals()[0].id })], "2026-11-10");
    addList("Wishlist", "🎧");
    await openPlans();
    fireEvent.click(await screen.findByRole("button", { name: /^Next: Shoes/ }));
    expect(await screen.findByText("10 Nov")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Planner tabs" })).getByText("Plans"));
    fireEvent.click(screen.getByRole("button", { name: "lists" }));
    expect(await screen.findByRole("list", { name: "All lists" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "goals" }));
    expect(screen.getByLabelText("New goal")).toBeTruthy();
  });
});

describe("links into the planner", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("opens a linked day, ignores a bad one, and clears the address", async () => {
    window.history.replaceState(null, "", "/planner-next?date=2026-11-20");
    const first = open();
    expect(await screen.findByText("20 Nov")).toBeTruthy();
    expect(window.location.search).toBe("");
    first.unmount();
    window.history.replaceState(null, "", "/planner-next?date=2026-13-45");
    open();
    expect(await screen.findByText("Sun · Today")).toBeTruthy();
  });

  it("opens a linked list item in Plans", async () => {
    const list = addList("Gifts", "🎁");
    const item = addItem(list.id, "Scarf");
    window.history.replaceState(null, "", `/planner-next?list=${list.id}&item=${item.id}`);
    open();
    expect(await screen.findByRole("heading", { name: /Gifts/ })).toBeTruthy();
    expect(screen.getByLabelText("Item text")).toBeTruthy(); // the item is open
    expect(window.location.search).toBe("");
  });
});

describe("more", () => {
  const bar = () => within(screen.getByRole("navigation", { name: "Planner tabs" }));
  const openMore = async (item?: string) => {
    open();
    await screen.findByText("8 Nov");
    fireEvent.click(bar().getByText("More"));
    if (item) fireEvent.click(menuItem(item));
  };
  const back = () => fireEvent.click(screen.getByText("‹ More"));
  const menuItem = (name: string) => within(screen.getByRole("list", { name: "More screens" })).getByRole("button", { name: new RegExp(`^${name}`) });

  it("lists each screen, opens it, and goes back by the link or the tab", async () => {
    await openMore();
    expect(menuItem("Reminders").textContent).toContain("Off");
    for (const name of ["Stats", "Day log items", "Tags", "Day templates", "Reminders", "Backup", "Sync"]) {
      fireEvent.click(menuItem(name));
      expect(screen.getByRole("heading", { name })).toBeTruthy();
      back();
    }
    fireEvent.click(menuItem("Tags"));
    fireEvent.click(bar().getByText("More"));
    expect(screen.getByRole("heading", { name: "More" })).toBeTruthy();
  });

  it("shows stats, with the review and today a tap away", async () => {
    await openMore("Stats");
    expect(await screen.findByText("Day log history")).toBeTruthy();
    fireEvent.click(screen.getByText("Plan your day"));
    expect(await screen.findByLabelText("Add a task")).toBeTruthy();
    saveTodos([todo("Taxes", { carriedFrom: "2026-11-04", postponed: 2 })], T);
    fireEvent.click(bar().getByText("More"));
    fireEvent.click(await screen.findByText(/in the weekly review/));
    expect(await screen.findByRole("list", { name: "Steps" })).toBeTruthy();
  });

  it("adds, renames, reorders and removes day log items, and Today follows", async () => {
    await openMore("Day log items");
    fireEvent.change(screen.getByLabelText("Rename Med 1"), { target: { value: "Metformin" } });
    fireEvent.blur(screen.getByLabelText("Rename Med 1"));
    fireEvent.change(await screen.findByLabelText("New log item"), { target: { value: "Pushups" } });
    fireEvent.change(screen.getByLabelText("Kind of item"), { target: { value: "number" } });
    fireEvent.submit(screen.getByLabelText("New log item"));
    expect(await screen.findByLabelText("Rename Pushups")).toBeTruthy();
    expect((screen.getByLabelText("New log item") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Move Bath up") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Move Pushups down") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move Brush up"));
    fireEvent.click(await screen.findByLabelText("Move Bath down"));
    fireEvent.click(screen.getByLabelText("Move Bath down"));
    fireEvent.click(screen.getByLabelText("Remove Yoga"));
    await waitFor(() => expect(screen.queryByLabelText("Rename Yoga")).toBeNull());
    // Refused names keep the old one.
    fireEvent.change(screen.getByLabelText("New log item"), { target: { value: "bath" } });
    fireEvent.submit(screen.getByLabelText("New log item"));
    expect(await flashed("There's already a bath item")).toBeTruthy();
    const walk = screen.getByLabelText("Rename Walk") as HTMLInputElement;
    fireEvent.change(walk, { target: { value: "" } });
    fireEvent.keyDown(walk, { key: "Enter" });
    fireEvent.blur(walk);
    expect(await flashed("Give the item a name")).toBeTruthy();
    expect(walk.value).toBe("Walk");

    fireEvent.click(bar().getByText("Today"));
    const names = within(await screen.findByRole("group", { name: "Log items" })).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    const joined = names.join("|");
    expect(joined.indexOf("Brush")).toBeLessThan(joined.indexOf("Stools"));
    expect(joined).toContain("Metformin");
    expect(joined).not.toContain("Yoga");
  });

  it("adds, renames and removes tags, refusing a duplicate", async () => {
    await openMore("Tags");
    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "Deep work" } });
    fireEvent.submit(screen.getByLabelText("New tag"));
    expect(await screen.findByLabelText("Rename Deep work")).toBeTruthy();
    expect((screen.getByLabelText("New tag") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "home" } });
    fireEvent.submit(screen.getByLabelText("New tag"));
    expect(await flashed("There's already a home tag")).toBeTruthy();
    const work = screen.getByLabelText("Rename Work") as HTMLInputElement;
    fireEvent.change(work, { target: { value: "Job" } });
    fireEvent.keyDown(work, { key: "Enter" });
    fireEvent.blur(work);
    expect(await screen.findByLabelText("Rename Job")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rename Job"), { target: { value: "Home" } });
    fireEvent.blur(screen.getByLabelText("Rename Job"));
    expect(await flashed("There's already a Home tag")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Job"));
    await waitFor(() => expect(screen.queryByLabelText("Rename Job")).toBeNull());
  });

  it("saves the open day as a template and applies one", async () => {
    saveTodos([todo("Standup", { start: 600, duration: 15 })], T);
    await openMore("Day templates");
    expect(screen.getByText(/the day open on Today: /)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Workday" } });
    fireEvent.submit(screen.getByLabelText("Template name"));
    expect(await flashed("Saved “Workday” with 1 task")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Apply “Workday”"));
    expect(await flashed("Everything in “Workday” is already on this day")).toBeTruthy();
  });

  it("turns reminders on and off, and they fire on any tab", async () => {
    resetNotifications();
    vi.stubGlobal("Notification", FakeNotification);
    await openMore("Reminders");
    const group = within(screen.getByRole("group", { name: "Reminders" }));
    fireEvent.click(group.getByText("5 min before"));
    expect(await flashed("Reminders on while this page is open")).toBeTruthy();
    expect(group.getByText("5 min before").getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("reel-radar-reminder-lead")).toBe("5");
    fireEvent.click(group.getByText("Off"));
    expect(localStorage.getItem("reel-radar-reminder-lead")).toBeNull();
    expect(group.getByText("Off").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps reminding while another tab is open", async () => {
    resetNotifications();
    vi.stubGlobal("Notification", FakeNotification);
    localStorage.setItem("reel-radar-reminder-lead", "5");
    saveTodos([todo("Meeting", { start: 583, duration: 30 })], T);
    await openMore();
    await waitFor(() => expect(FakeNotification.sent.map((n) => n.title)).toEqual(["Meeting"]));
  });

  it("exports and imports a backup", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openMore("Backup");
    fireEvent.click(screen.getByText("Export"));
    expect(await flashed("Backup saved")).toBeTruthy();
    expect(click).toHaveBeenCalled();
    const input = screen.getByLabelText("Backup file to import");
    const file = (body: unknown) => new File([JSON.stringify(body)], "b.json");
    fireEvent.change(input, {
      target: {
        files: [
          file({
            app: "planner",
            version: 3,
            days: { [T]: [todo("x"), todo("y")], [Y]: [todo("z")] },
            daily: [{ id: "d", text: "D", startDate: T }],
            log: { [T]: { weight: 71 } },
            lists: { lists: [{ id: "l", name: "Gifts", createdAt: 1 }], items: [{ id: "i", listId: "l", text: "Scarf", done: false, createdAt: 1 }] },
          }),
        ],
      },
    });
    expect(await flashed("Imported 3 todos across 2 days + 1 daily task + 1 day log + 1 list item")).toBeTruthy();
    expect(loadDayLog(T).weight).toBe(71);
    fireEvent.change(input, { target: { files: [file({ app: "planner", version: 2, days: { [T]: [todo("w")] }, daily: [] })] } });
    expect(await flashed("Imported 1 todo across 1 day")).toBeTruthy();
    fireEvent.change(input, { target: { files: [file({ nope: true })] } });
    expect(await flashed("Not a planner backup file.")).toBeTruthy();
    fireEvent.change(input, { target: { files: [] } });
  });

  it("warns when an export couldn't pull from the server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openMore("Backup");
    routeFetch({ "/api/sync": () => new Response("{}", { status: 500 }) });
    fireEvent.click(screen.getByText("Export"));
    expect(await flashed("Couldn't reach the server, so the backup only has this device's copy")).toBeTruthy();
  });

  it("syncs now and shows how it went", async () => {
    await openMore("Sync");
    fireEvent.click(screen.getByText("Sync now"));
    expect(await screen.findByText("Synced", { selector: "[role=status]" })).toBeTruthy();
    vi.spyOn(console, "error").mockImplementation(() => {});
    routeFetch({ "/api/sync": () => new Response("{}", { status: 500 }) });
    await waitFor(() => expect((screen.getByText("Sync now") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText("Sync now"));
    expect(await screen.findByText(/Couldn't reach the server\. Changes stay/, { selector: "[role=status]" })).toBeTruthy();
  });
});

describe("search", () => {
  it("opens over any tab and takes you to what it finds", async () => {
    saveTodos([todo("Dentist")], "2026-11-12");
    const list = addList("Gifts");
    addItem(list.id, "Dentist voucher");
    addGoal("See the dentist");
    open();
    await screen.findByText("8 Nov");
    const find = () => {
      fireEvent.click(screen.getByLabelText("Search the planner"));
      fireEvent.change(screen.getByLabelText("Search the whole planner"), { target: { value: "dentist" } });
    };
    find();
    expect(screen.queryByLabelText("Previous day")).toBeNull();
    // Keys typed elsewhere don't change the day under it.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByText("Dentist").closest("button")!);
    expect(await screen.findByText("12 Nov")).toBeTruthy();
    find();
    fireEvent.click(screen.getByText("Dentist voucher").closest("button")!);
    expect(await screen.findByDisplayValue("Dentist voucher")).toBeTruthy();
    find();
    fireEvent.click(screen.getByText("See the dentist").closest("button")!);
    expect(await screen.findByRole("listitem", { name: "See the dentist" })).toBeTruthy();
    // The search button closes it again, and so does any tab.
    fireEvent.click(screen.getByLabelText("Search the planner"));
    fireEvent.click(screen.getByLabelText("Search the planner"));
    expect(screen.queryByLabelText("Search the whole planner")).toBeNull();
    fireEvent.click(screen.getByLabelText("Search the planner"));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Planner tabs" })).getByText("Today"));
    expect(await screen.findByLabelText("Add a task")).toBeTruthy();
  });

  it("searches every day from a filter with no matches", async () => {
    saveTodos([todo("Laundry")], T);
    saveTodos([todo("Dentist")], "2026-11-12");
    open();
    fireEvent.change(await screen.findByLabelText("Filter this day"), { target: { value: "dentist" } });
    fireEvent.click(screen.getByRole("button", { name: "Search every day →" }));
    expect((screen.getByLabelText("Search the whole planner") as HTMLInputElement).value).toBe("dentist");
    expect(screen.getByText("Dentist")).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    expect(await screen.findByLabelText("Filter this day")).toBeTruthy();
  });
});

describe("checklist extras", () => {
  it("clears finished tasks after a second tap", async () => {
    saveTodos([todo("Gym", { completed: true, doneAt: 1 }), todo("Read", { completed: true, doneAt: 2 }), todo("Taxes")], T);
    open();
    fireEvent.click(await screen.findByText("Clear completed"));
    expect(loadTodos(T)).toHaveLength(3);
    fireEvent.click(screen.getByText("Clear 2 done? Tap again"));
    expect(await flashed("Cleared 2 done tasks")).toBeTruthy();
    expect(loadTodos(T).map((t) => t.text)).toEqual(["Taxes"]);
    expect(screen.queryByText("Clear completed")).toBeNull();
  });

  it("forgets a first tap on Clear completed when focus moves away", async () => {
    saveTodos([todo("Gym", { completed: true })], T);
    open();
    fireEvent.click(await screen.findByText("Clear completed"));
    fireEvent.blur(screen.getByText("Clear 1 done? Tap again"));
    expect(screen.getByText("Clear completed")).toBeTruthy();
  });

  it("shows the days around this one, with how much got done, and opens one", async () => {
    saveTodos([todo("A", { completed: true }), todo("B")], "2026-11-06");
    saveTodos([todo("C", { completed: true })], "2026-11-10");
    open();
    const strip = within(await screen.findByRole("group", { name: "Days around this one" }));
    expect(strip.getAllByRole("button")).toHaveLength(7);
    expect(strip.getByLabelText(/Nov 8.*nothing planned/).getAttribute("aria-current")).toBe("date");
    expect(strip.getByLabelText(/Nov 6.*1 of 2 done/)).toBeTruthy();
    fireEvent.click(strip.getByLabelText(/Nov 10.*1 of 1 done/));
    expect(await screen.findByText("10 Nov")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Days around this one" })).getByLabelText(/Nov 8/).textContent).toContain("8");
  });

  it("has the app switcher in the header", async () => {
    open();
    expect(await screen.findByRole("link", { name: /Home/ })).toBeTruthy();
  });

  it("renders on the server without reading the browser", () => {
    const html = renderToString(<PlannerNextPage />);
    expect(html).toContain("Today");
    expect(html).not.toContain("8 Nov"); // the day comes from the browser's clock, after mount
  });
});

describe("push reminders", () => {
  const fakeWorker = () => {
    const subscribe = vi.fn(async () => ({ endpoint: "https://fcm.googleapis.com/x", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/x" }) }));
    const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe }, showNotification: vi.fn(async (_title: string) => {}) };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) } });
    vi.stubGlobal("PushManager", class {});
    return reg;
  };
  beforeEach(() => {
    resetNotifications();
    vi.stubGlobal("Notification", FakeNotification);
  });
  afterEach(() => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it("subscribes the device when reminders go on, so they arrive with the app closed", async () => {
    fakeWorker();
    const fetch = routeFetch({ "/api/push": { publicKey: "AQAB" } });
    open();
    fireEvent.change(await screen.findByLabelText("Reminders"), { target: { value: "10" } });
    expect(await flashed("Reminders on, even with the app closed")).toBeTruthy();
    const post = requests(fetch, "/api/push").find((r) => r.init?.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toMatchObject({ lead: 10, timeZone: expect.any(String) });
  });

  it("falls back to the open page when the server has no push set up", async () => {
    fakeWorker();
    routeFetch({ "/api/push": () => jsonResponse({}, { status: 503 }) });
    open();
    fireEvent.change(await screen.findByLabelText("Reminders"), { target: { value: "5" } });
    expect(await flashed("Reminders on while this page is open")).toBeTruthy();
  });

  it("refreshes the subscription on open when reminders were already on, and shows page reminders through the worker", async () => {
    const reg = fakeWorker();
    const fetch = routeFetch({ "/api/push": { publicKey: "AQAB" } });
    localStorage.setItem("reel-radar-reminder-lead", "5");
    saveTodos([todo("Meeting", { start: 583, duration: 30 })], T);
    open();
    await waitFor(() => expect(requests(fetch, "/api/push").some((r) => r.init?.method === "POST")).toBe(true));
    await waitFor(() => expect(reg.showNotification).toHaveBeenCalled());
    expect(reg.showNotification.mock.calls[0][0]).toBe("Meeting");
    expect(FakeNotification.sent).toEqual([]);
  });

  it("unsubscribes when reminders go off", async () => {
    const reg = fakeWorker();
    const unsubscribe = vi.fn(async () => true);
    reg.pushManager.getSubscription.mockResolvedValue({ endpoint: "https://fcm.googleapis.com/x", unsubscribe } as never);
    const fetch = routeFetch({ "/api/push": { publicKey: "AQAB" } });
    localStorage.setItem("reel-radar-reminder-lead", "5");
    open();
    fireEvent.change(await screen.findByLabelText("Reminders"), { target: { value: "" } });
    await waitFor(() => expect(requests(fetch, "/api/push").some((r) => r.init?.method === "DELETE")).toBe(true));
    expect(unsubscribe).toHaveBeenCalled();
  });
});
