// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Todo, getTodayDate, shiftDate } from "@/lib/todos";
import {
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
  it("draws overlapping blocks one after another and leaves the rest in place", () => {
    const lanes = layoutBlocks([
      todo("a", { start: 540, duration: 60 }),
      todo("b", { start: 570, duration: 60 }),
      todo("c", { start: 600, duration: undefined }), // default length
      todo("d", { start: 720, duration: 30 }),
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 1, shift: 0 });
    expect(lanes.get("b")).toEqual({ lane: 0, lanes: 1, shift: 30 }); // 10:00
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 1, shift: 60 }); // 11:00
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1, shift: 0 });
  });

  it("treats a short block as taking the height it is drawn at", () => {
    // A 15-minute block is drawn ~21 minutes tall, so one starting right after is pushed below it.
    const lanes = layoutBlocks([todo("a", { start: 540, duration: 15 }), todo("b", { start: 555, duration: 15 })]);
    expect(lanes.get("b")?.shift).toBeCloseTo(5.625);
  });
});
