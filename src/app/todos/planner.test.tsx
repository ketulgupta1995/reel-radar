// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Todo, getTodayDate, shiftDate } from "@/lib/todos";
import {
  TimeBlock,
  clampStart,
  fmtDuration,
  fmtTime,
  formatDate,
  formatShortDate,
  getRelativeDateLabel,
  layoutBlocks,
  snap,
  useBlockResize,
} from "./planner";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: id,
  completed: false,
  createdAt: "2026-03-01T00:00:00.000Z",
  start: 540,
  duration: 60,
  ...extra,
});

// jsdom has no PointerEvent; a MouseEvent with the pointer type carries clientY just as well.
const pointer = (target: EventTarget, type: string, clientY: number) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
  });

afterEach(() => vi.useRealTimers());

describe("formatting", () => {
  it("formats times, lengths and dates", () => {
    expect(fmtTime(0)).toBe("12 AM");
    expect(fmtTime(13 * 60 + 5)).toBe("1:05 PM");
    expect(fmtDuration(120)).toBe("2h");
    expect(fmtDuration(90)).toBe("1h 30m");
    expect(fmtDuration(45)).toBe("45m");
    expect(snap(52)).toBe(45);
    expect(clampStart(1430, 60)).toBe(1380);
    expect(clampStart(-5, 60)).toBe(0);
    expect(formatShortDate("2026-03-02")).toBe("Mar 2");
    expect(formatDate("2026-03-02")).toBe("Mon, Mar 2, 2026");
  });

  it("names today, yesterday and tomorrow", () => {
    const today = getTodayDate();
    expect(getRelativeDateLabel(today)).toBe("Today");
    expect(getRelativeDateLabel(shiftDate(today, -1))).toBe("Yesterday");
    expect(getRelativeDateLabel(shiftDate(today, 1))).toBe("Tomorrow");
    expect(getRelativeDateLabel("2026-03-02")).toBe("Mon, Mar 2, 2026");
  });
});

describe("layoutBlocks", () => {
  it("puts overlapping blocks side by side and the rest in one lane", () => {
    const lanes = layoutBlocks([
      todo("a", { start: 540, duration: 60 }),
      todo("b", { start: 570, duration: 60 }),
      todo("c", { start: 600, duration: undefined }), // default length
      todo("d", { start: 720, duration: 30 }),
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("TimeBlock", () => {
  const block = (t: Todo, props: Partial<Parameters<typeof TimeBlock>[0]> = {}) => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useBlockResize(onCommit));
    const view = render(
      <TimeBlock todo={t} date="2026-03-02" lane={0} lanes={1} resize={result.current} onSelect={onSelect} onToggle={onToggle} {...props} />
    );
    return { onSelect, onToggle, onCommit, result, view };
  };

  it("shows the task and its time, and selects or toggles it", () => {
    const t = todo("Write", { note: "draft", spent: 30, tag: "work", priority: "high" });
    const { onSelect, onToggle, view } = block(t, { selected: true });
    expect(screen.getByText("9 AM – 10 AM · ⏱ 30m")).toBeTruthy();
    expect(view.container.firstElementChild!.getAttribute("title")).toBe("Write · 9 AM–10 AM\ndraft");
    fireEvent.click(screen.getByText("Write"));
    expect(onSelect).toHaveBeenCalledWith(t);
    fireEvent.click(screen.getByLabelText("Mark as complete"));
    expect(onToggle).toHaveBeenCalledWith(t);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows only the start in the compact week view, and nothing for short blocks", () => {
    block(todo("Week", { completed: true }), { compact: true });
    expect(screen.getByText("9 AM")).toBeTruthy();
    expect(screen.getByLabelText("Mark as incomplete")).toBeTruthy();
    block(todo("Short", { duration: 30 }));
    expect(screen.queryByText(/9 AM – 9:30 AM/)).toBeNull();
  });

  it("records the block's id and day when dragged", () => {
    block(todo("Drag"));
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), effectAllowed: "" };
    fireEvent.dragStart(screen.getByText("Drag").closest("[draggable]")!, { dataTransfer });
    expect(data).toEqual({ "text/todo-id": "Drag", "text/todo-date": "2026-03-02" });
  });

  it("resizes by dragging the bottom edge, snapping to 15 minutes", () => {
    vi.useFakeTimers();
    const { onCommit, result } = block(todo("Long"));
    const handle = screen.getByTitle("Drag to change length");
    pointer(handle, "pointerdown", 100);
    pointer(window, "pointermove", 100 + 64); // one hour down
    expect(result.current.preview).toEqual({ id: "Long", duration: 120 });
    pointer(window, "pointerup", 164);
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: "Long" }), "2026-03-02", 120);
    expect(result.current.preview).toBeNull();
    expect(result.current.active.current).toBe(true); // swallows the click that follows
    act(() => void vi.runAllTimers());
    expect(result.current.active.current).toBe(false);
  });

  it("doesn't commit a drag that ends where it started, and ignores clicks during one", () => {
    const { onCommit, onSelect, result } = block(todo("Same"));
    pointer(screen.getByTitle("Drag to change length"), "pointerdown", 100);
    fireEvent.click(screen.getByText("Same"));
    expect(onSelect).not.toHaveBeenCalled();
    const dataTransfer = { setData: vi.fn() };
    fireEvent.dragStart(screen.getByText("Same").closest("[draggable]")!, { dataTransfer });
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    pointer(window, "pointercancel", 100);
    expect(onCommit).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it("previews the new length while resizing", () => {
    const t = todo("Grow");
    const onCommit = vi.fn();
    const { result } = renderHook(() => useBlockResize(onCommit));
    pointer(document.body, "pointerdown", 0); // nothing listening yet
    act(() => result.current.start({ clientY: 0, stopPropagation() {}, preventDefault() {} } as React.PointerEvent, t, "d"));
    pointer(window, "pointermove", 32);
    render(<TimeBlock todo={t} date="d" lane={0} lanes={1} resize={result.current} onSelect={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByText("9 AM – 10:30 AM · 1h 30m")).toBeTruthy();
    pointer(window, "pointerup", 32);
  });
});
