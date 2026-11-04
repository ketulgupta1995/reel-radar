// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Todo } from "@/lib/todos";
import { nextUp } from "./NextUp";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "2026-01-01T00:00:00.000Z", ...extra });
const at = (hour: number) => hour * 60;

describe("nextUp", () => {
  it("picks the block under way", () => {
    const todos = [todo("later", { start: at(15) }), todo("now", { start: at(9), duration: 120 })];
    expect(nextUp(todos, at(10))).toMatchObject({ todo: { id: "now" }, label: "Now" });
  });

  it("uses the default length for a block with none, and counts its end as over", () => {
    const todos = [todo("block", { start: at(9) })];
    expect(nextUp(todos, at(9))?.label).toBe("Now");
    expect(nextUp(todos, at(12))?.label).toBe("Up next");
  });

  it("otherwise picks the soonest block still to come, over an unscheduled task", () => {
    const todos = [todo("first", { priority: "high" }), todo("late", { start: at(18) }), todo("soon", { start: at(12) })];
    expect(nextUp(todos, at(10))).toMatchObject({ todo: { id: "soon" }, label: "Next · 12 PM" });
  });

  it("falls back to the top of the list when no block is left", () => {
    const todos = [todo("missed", { start: at(8), duration: 30 }), todo("first", { priority: "high" })];
    expect(nextUp(todos, at(10))).toMatchObject({ todo: { id: "first" }, label: "Up next" });
  });

  it("ignores finished tasks, and has nothing when all are done", () => {
    expect(nextUp([todo("done", { completed: true, start: at(10) })], at(10))).toBeNull();
    expect(nextUp([], at(10))).toBeNull();
  });
});
