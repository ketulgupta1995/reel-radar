// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { jsonResponse } from "@/test/fixtures";
import { requests, routeFetch } from "@/test/pages";
import { addItem, addList } from "@/lib/lists";
import { addGoal, loadGoals } from "@/lib/plannerSettings";
import { loadDayLog, loadTodos, saveTodos, updateDayLog } from "@/lib/todos";
import { T, Y, todo, at, open, tasks, flashed, FakeNotification, resetNotifications, weekDrag } from "@/test/planner";

vi.mock("next/navigation", () => ({ usePathname: () => "/todos" }));

import PlannerPage from "./page";

let fetchMock: ReturnType<typeof routeFetch>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(9, 40);
  fetchMock = routeFetch();
});
afterEach(() => {
  vi.useRealTimers();
});

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
    window.history.replaceState(null, "", "/todos?date=2026-11-20");
    const first = open();
    expect(await screen.findByText("20 Nov")).toBeTruthy();
    expect(window.location.search).toBe("");
    first.unmount();
    window.history.replaceState(null, "", "/todos?date=2026-13-45");
    open();
    expect(await screen.findByText("Sun · Today")).toBeTruthy();
  });

  it("opens a linked list item in Plans", async () => {
    const list = addList("Gifts", "🎁");
    const item = addItem(list.id, "Scarf");
    window.history.replaceState(null, "", `/todos?list=${list.id}&item=${item.id}`);
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
    for (const name of ["Stats", "Day log items", "Tags", "Day templates", "Reminders", "Backup", "Bin", "Sync"]) {
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

  it("keeps deleted tasks in the bin and restores them to their day", async () => {
    saveTodos([todo("Report"), todo("Old", { completed: true })], T);
    const ago = (ms: number) => ({ deletedAt: Date.now() - ms, updatedAt: 1 });
    const H = 60 * 60 * 1000;
    localStorage.setItem(
      "reel-radar-planner-bin",
      JSON.stringify({ items: [{ todo: todo("Lunch", { completed: true }), date: Y, ...ago(3 * H) }, { todo: todo("Gym"), date: "2026-11-05", ...ago(50 * H) }] })
    );
    open();
    fireEvent.click(await tasks().findByLabelText("Open “Report”"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Task details" })).getByText("Delete"));
    await flashed("Deleted “Report”");
    fireEvent.click(bar().getByText("More"));
    fireEvent.click(menuItem("Bin"));
    const bin = () => within(screen.getByRole("list", { name: "Deleted tasks" }));
    expect((await screen.findByRole("list", { name: "Deleted tasks" })).textContent).toContain("deleted just now · gone in 7d");
    expect(bin().getByText("Lunch").className).toContain("line-through");
    expect(bin().getAllByRole("listitem").map((li) => li.textContent?.replace("Restore", ""))).toEqual([
      "ReportSun, Nov 8, 2026 · deleted just now · gone in 7d",
      "LunchSat, Nov 7, 2026 · deleted 3h ago · gone in 7d",
      "GymThu, Nov 5, 2026 · deleted 2d ago · gone in 5d",
    ]);
    fireEvent.click(bin().getByLabelText("Restore Report"));
    expect(await flashed("Restored “Report” to Sun, Nov 8, 2026")).toBeTruthy();
    expect(loadTodos(T).map((t) => t.id).sort()).toEqual(["Old", "Report"]);
    expect(bin().queryByText("Report")).toBeNull();
    fireEvent.click(bin().getByLabelText("Restore Lunch"));
    // One restore at a time: the others wait until it's done.
    expect((bin().getByLabelText("Restore Gym") as HTMLButtonElement).disabled).toBe(true);
    await flashed(/Restored “Lunch”/);
    fireEvent.click(bin().getByLabelText("Restore Gym"));
    expect(await screen.findByText("The bin is empty.")).toBeTruthy();
    expect(loadTodos("2026-11-05").map((t) => t.id)).toEqual(["Gym"]);
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
    const html = renderToString(<PlannerPage />);
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
