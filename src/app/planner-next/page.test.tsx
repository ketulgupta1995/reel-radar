// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { routeFetch } from "@/test/pages";
import { addList, loadItems } from "@/lib/lists";
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

  it("has four tabs, pointing to the current planner for those not built yet, and marks a review due on Sunday", async () => {
    open();
    const bar = within(screen.getByRole("navigation", { name: "Planner tabs" }));
    expect(await bar.findByLabelText("Weekly review is ready")).toBeTruthy();
    fireEvent.click(bar.getByText("Plans"));
    expect(screen.getByRole("link", { name: "Goals →" }).getAttribute("href")).toBe("/todos/goals");
    expect(screen.queryByLabelText("Previous day")).toBeNull();
    fireEvent.click(bar.getByText("Calendar"));
    expect(screen.getByText(/week and month views/)).toBeTruthy();
    fireEvent.click(bar.getByText("More"));
    expect(screen.getByRole("link", { name: "Stats →" })).toBeTruthy();
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
    expect(await screen.findByText("Gym")).toBeTruthy();
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
