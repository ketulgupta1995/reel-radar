// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { routeFetch } from "@/test/pages";
import { Todo, addTodo, loadTodos, saveTodos } from "@/lib/todos";
import WeekView from "./WeekView";

const MON = "2026-03-02"; // a Monday; the week runs Mon 2 – Sun 8
const TUE = "2026-03-03";
const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: "2026-03-01T00:00:00.000Z",
  ...extra,
});

// A drag carrying a todo, as TimeBlock and the "to do" chips set it.
const carrying = (id: string, from: string, keys: Partial<Record<"ctrlKey" | "altKey", boolean>> = {}, clientY = 0) => ({
  dataTransfer: { getData: (k: string) => ({ "text/todo-id": id, "text/todo-date": from })[k] ?? "", dropEffect: "" },
  clientY,
  ...keys,
});
// jsdom has no DragEvent, so the generic Event it falls back to drops clientY and the modifier
// keys; set them on the event itself.
const drag = (kind: "dragOver" | "drop", el: HTMLElement, init: ReturnType<typeof carrying>) => {
  const { dataTransfer, ...props } = init;
  const event = createEvent[kind](el, { dataTransfer });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(event, k, { value: v });
  fireEvent(el, event);
};
// The hour grid column for a day (the columns after the time labels), and its "to do" strip.
const gridColumn = (container: HTMLElement, dayIndex: number) =>
  container.querySelectorAll<HTMLElement>("[style*='height: 1536px'] > div")[dayIndex + 1];
const todoStrip = (dayIndex: number) => screen.getAllByText("To do")[0].parentElement!.children[dayIndex + 1] as HTMLElement;

let onOpenDay: Mock<(date: string) => void>;
let flash: Mock<(message: string) => void>;
beforeEach(() => {
  routeFetch();
  onOpenDay = vi.fn();
  flash = vi.fn();
});
const view = () => render(<WeekView anchorDate={MON} now={600} onOpenDay={onOpenDay} flash={flash} />);

describe("WeekView", () => {
  it("shows the week's totals, day headers and blocks", async () => {
    saveTodos([todo("Plan", { start: 540, duration: 90, completed: true }), todo("Loose")], MON);
    saveTodos([todo("Gym", { start: 1080 })], TUE);
    view();
    expect(await screen.findByText("1/3 done · 2h 30m planned")).toBeTruthy();
    expect(screen.getByText("Mon 2")).toBeTruthy();
    expect(screen.getByText("Sun 8")).toBeTruthy();
    expect(screen.getByText("1/2 done")).toBeTruthy();
    expect(screen.getByText("Loose")).toBeTruthy();
    expect(screen.getByText("Gym")).toBeTruthy();
  });

  it("opens a day from its header, a chip, a block or the overflow link", async () => {
    saveTodos(Array.from({ length: 6 }, (_, i) => todo(`t${i}`)).concat(todo("Block", { start: 600 })), MON);
    view();
    fireEvent.click(await screen.findByText("+2 more"));
    fireEvent.click(screen.getByText("t0"));
    fireEvent.click(screen.getByText("Block"));
    fireEvent.click(screen.getAllByTitle(/^Open /)[0]);
    expect(onOpenDay).toHaveBeenCalledTimes(4);
    expect(onOpenDay).toHaveBeenCalledWith(MON);
  });

  it("toggles a block done", async () => {
    saveTodos([todo("Block", { start: 600 })], MON);
    view();
    fireEvent.click(await screen.findByLabelText("Mark as complete"));
    expect(loadTodos(MON)[0].completed).toBe(true);
    expect(screen.getByText("1/1 done · 1h planned")).toBeTruthy();
  });

  it("moves a dropped todo into a time slot on another day", async () => {
    saveTodos([todo("Chip")], MON);
    const { container } = view();
    await screen.findByText("Chip");
    const tuesday = gridColumn(container, 1);
    drag("dragOver", tuesday, carrying("Chip", MON, {}, 2 * 64)); // 2 AM
    expect(screen.getByText("2 AM", { selector: "span.rounded" })).toBeTruthy();
    drag("drop", tuesday, carrying("Chip", MON, {}, 9 * 64));
    expect(loadTodos(MON)).toEqual([]);
    expect(loadTodos(TUE)[0]).toMatchObject({ id: "Chip", start: 540 });
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/^Moved to /));
  });

  it("copies when Ctrl or Alt is held, and unschedules on the to-do strip", async () => {
    saveTodos([todo("Block", { start: 600, duration: 30 })], MON);
    const { container } = view();
    await screen.findByText("Block");
    drag("dragOver", gridColumn(container, 1), carrying("Block", MON, { ctrlKey: true }, 64));
    expect(screen.getByText(/Copy ·/)).toBeTruthy();
    drag("drop", gridColumn(container, 1), carrying("Block", MON, { altKey: true }, 64));
    expect(loadTodos(MON)).toHaveLength(1);
    expect(loadTodos(TUE)[0]).toMatchObject({ text: "Block", start: 60 });
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/^Copied to /));

    drag("dragOver", todoStrip(0), carrying("Block", MON));
    fireEvent.dragLeave(todoStrip(0));
    drag("drop", todoStrip(0), carrying("Block", MON));
    expect(loadTodos(MON)[0].start).toBeUndefined();
    expect(flash).toHaveBeenCalledTimes(1); // same day: no "moved" message
  });

  it("keeps a daily task's copy on its own day, and ignores unknown drops", async () => {
    addTodo("Stretch", MON, undefined, { start: 420 }, true);
    const { container } = view();
    await screen.findAllByText("Stretch");
    drag("drop", gridColumn(container, 1), carrying(loadTodos(MON)[0].id, MON, {}, 64));
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/^Repeating tasks stay on their own day/));
    drag("drop", gridColumn(container, 1), carrying("missing", MON));
    drag("drop", gridColumn(container, 1), carrying("missing", ""));
    fireEvent.dragLeave(gridColumn(container, 1));
    expect(flash).toHaveBeenCalledTimes(1);
  });

  it("resizes a block from the week view", async () => {
    saveTodos([todo("Grow", { start: 600 })], MON);
    view();
    await screen.findByText("Grow");
    const handle = screen.getByTitle("Drag to change length");
    act(() => void handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 0 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientY: 32 })));
    act(() => void window.dispatchEvent(new MouseEvent("pointerup", { clientY: 32 })));
    expect(loadTodos(MON)[0].duration).toBe(90);
  });

  it("adds daily copies and shows a remote change after syncing", async () => {
    addTodo("Read", MON, undefined, undefined, true);
    view();
    await waitFor(() => expect(screen.getAllByText("Read").length).toBeGreaterThan(1)); // copies on later days too
    const tuesdayCopy = loadTodos(TUE)[0];
    saveTodos([{ ...tuesdayCopy, text: "Read 20 pages" }], TUE);
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: ["planner-2026-03"] } })));
    expect(await screen.findByText("Read 20 pages")).toBeTruthy();
  });
});
