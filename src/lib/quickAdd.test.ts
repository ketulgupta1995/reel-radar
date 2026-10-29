import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickAdd";

describe("parseQuickAdd", () => {
  it("leaves plain titles alone, numbers included", () => {
    expect(parseQuickAdd("  Read 20 pages ")).toEqual({ text: "Read 20 pages" });
    expect(parseQuickAdd("")).toEqual({ text: "" });
  });

  it("pulls out time, length, tag, priority and repeat", () => {
    expect(parseQuickAdd("Gym 6:30pm 45m #health !high daily")).toEqual({
      text: "Gym",
      start: 18 * 60 + 30,
      duration: 45,
      tag: "health",
      priority: "high",
      daily: true,
    });
  });

  it("reads the usual ways of writing a time", () => {
    expect(parseQuickAdd("a 7am").start).toBe(7 * 60);
    expect(parseQuickAdd("a 12am").start).toBe(0);
    expect(parseQuickAdd("a 12pm").start).toBe(12 * 60);
    expect(parseQuickAdd("a 6 pm").start).toBe(18 * 60);
    expect(parseQuickAdd("a 18:05").start).toBe(18 * 60 + 5);
    expect(parseQuickAdd("a 9.15am").start).toBe(9 * 60 + 15);
    expect(parseQuickAdd("Call mom at 3")).toEqual({ text: "Call mom", start: 15 * 60 });
    expect(parseQuickAdd("Call at 9")).toEqual({ text: "Call", start: 9 * 60 });
    expect(parseQuickAdd("Call at 7 pm")).toEqual({ text: "Call", start: 19 * 60 });
    expect(parseQuickAdd("Call @10:30")).toEqual({ text: "Call", start: 10 * 60 + 30 });
  });

  it("keeps words that only look like times", () => {
    expect(parseQuickAdd("Meet at noon")).toEqual({ text: "Meet at noon" });
    expect(parseQuickAdd("Look at")).toEqual({ text: "Look at" });
    expect(parseQuickAdd("Room 13pm 25:00 9:75 at 13")).toEqual({ text: "Room 13pm 25:00 9:75 at 13" });
  });

  it("reads lengths in minutes and hours", () => {
    expect(parseQuickAdd("a 1h").duration).toBe(60);
    expect(parseQuickAdd("a 1.5h").duration).toBe(90);
    expect(parseQuickAdd("a 2hrs").duration).toBe(120);
    expect(parseQuickAdd("a 1h30").duration).toBe(90);
    expect(parseQuickAdd("a 1h30m").duration).toBe(90);
    expect(parseQuickAdd("a 20min").duration).toBe(20);
    expect(parseQuickAdd("a 0m 25h")).toEqual({ text: "a 0m 25h" });
  });

  it("knows tag labels and priority shorthands, and only takes the first of each", () => {
    expect(parseQuickAdd("Buy milk #Errands !l")).toEqual({ text: "Buy milk", tag: "errands", priority: "low" });
    expect(parseQuickAdd("x !2 !1 #work #home")).toEqual({ text: "x !1 #home", priority: "medium", tag: "work" });
    expect(parseQuickAdd("x #nope !!")).toEqual({ text: "x #nope", priority: "high" });
    expect(parseQuickAdd("Stretch every day")).toEqual({ text: "Stretch", daily: true });
    expect(parseQuickAdd("Stretch everyday 9am 10am")).toEqual({ text: "Stretch 10am", daily: true, start: 9 * 60 });
  });
});
