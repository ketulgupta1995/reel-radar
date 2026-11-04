// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addTag } from "./plannerSettings";
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

// 2026-11-04 is a Wednesday.
const TODAY = "2026-11-04";
const localStorage_addTag = () => addTag("Deep work");
const parse = (input: string) => parseQuickAdd(input, TODAY);

describe("dates in quick add", () => {
  it("reads today and tomorrow", () => {
    expect(parse("Call mom tomorrow")).toEqual({ text: "Call mom", date: "2026-11-05" });
    expect(parse("Call mom tmrw 6pm")).toEqual({ text: "Call mom", date: "2026-11-05", start: 18 * 60 });
    expect(parse("today Call mom")).toEqual({ text: "Call mom", date: TODAY });
  });

  it("reads a weekday as the next one, never today", () => {
    expect(parse("Pay bill fri")).toMatchObject({ text: "Pay bill", date: "2026-11-06" });
    expect(parse("Pay bill Friday")).toMatchObject({ date: "2026-11-06" });
    expect(parse("Pay bill wed")).toMatchObject({ date: "2026-11-11" });
    expect(parse("Pay bill tue")).toMatchObject({ date: "2026-11-10" });
  });

  it("reads next and on before a weekday", () => {
    expect(parse("Dentist next fri")).toMatchObject({ text: "Dentist", date: "2026-11-13" });
    expect(parse("Dentist next mon")).toMatchObject({ date: "2026-11-09" });
    expect(parse("Dentist on sat")).toMatchObject({ date: "2026-11-07" });
    expect(parse("Plan next steps")).toEqual({ text: "Plan next steps" });
  });

  it("reads a day and month in either order, rolling over to next year", () => {
    expect(parse("Trip 15 nov")).toMatchObject({ text: "Trip", date: "2026-11-15" });
    expect(parse("Trip nov 15")).toMatchObject({ date: "2026-11-15" });
    expect(parse("Trip 15th November")).toMatchObject({ date: "2026-11-15" });
    expect(parse("Trip 3 jan")).toMatchObject({ date: "2027-01-03" });
    expect(parse("Trip 4 nov")).toMatchObject({ date: TODAY });
    expect(parse("Trip 3 nov")).toMatchObject({ date: "2027-11-03" });
  });

  it("leaves dates that don't exist and bare numbers in the title", () => {
    expect(parse("Trip 31 feb")).toEqual({ text: "Trip 31 feb" });
    expect(parse("Trip feb 31")).toEqual({ text: "Trip feb 31" });
    expect(parse("Read 20 pages")).toEqual({ text: "Read 20 pages" });
    expect(parse("Trip 45 nov")).toEqual({ text: "Trip 45 nov" });
    expect(parse("May the best win")).toEqual({ text: "May the best win" });
  });

  it("only takes sun, sat and mon as days at the end of the title or with on", () => {
    expect(parse("Sun cream")).toEqual({ text: "Sun cream" });
    expect(parse("Buy sun cream")).toEqual({ text: "Buy sun cream" });
    expect(parse("Sat exam prep")).toEqual({ text: "Sat exam prep" });
    expect(parse("Go out in the sun")).toEqual({ text: "Go out in the sun" });
    expect(parse("Call home sun")).toEqual({ text: "Call home", date: "2026-11-08" });
    expect(parse("Call home sat 6pm #home")).toMatchObject({ text: "Call home", date: "2026-11-07", start: 18 * 60, tag: "home" });
    expect(parse("Call on mon home")).toMatchObject({ text: "Call home", date: "2026-11-09" });
  });

  it("takes only the first date, and isn't fooled by object property names", () => {
    expect(parse("Tomorrow plan fri")).toEqual({ text: "plan fri", date: "2026-11-05" });
    expect(parse("Read constructor")).toEqual({ text: "Read constructor" });
    expect(parse("every constructor")).toEqual({ text: "every constructor" });
  });
});

describe("repeats in quick add", () => {
  it("reads every N days and weeks", () => {
    expect(parse("Water plants every 3 days")).toEqual({ text: "Water plants", repeat: { every: 3 } });
    expect(parse("Review every 2 weeks")).toEqual({ text: "Review", repeat: { every: 14 } });
    expect(parse("Laundry every other day")).toEqual({ text: "Laundry", repeat: { every: 2 } });
    expect(parse("Laundry every 1 day")).toEqual({ text: "Laundry every 1 day" });
    expect(parse("Laundry every 900 days")).toEqual({ text: "Laundry every 900 days" });
  });

  it("reads monthly forms, including \"on the 1st\"", () => {
    expect(parse("Pay rent on the 1st")).toEqual({ text: "Pay rent", repeat: { monthDay: 1 } });
    expect(parse("Pay rent monthly on the 22nd")).toEqual({ text: "Pay rent", repeat: { monthDay: 22 } });
    expect(parse("Pay rent monthly on 5")).toEqual({ text: "Pay rent", repeat: { monthDay: 5 } });
    expect(parse("Pay rent every month on the 3rd")).toEqual({ text: "Pay rent", repeat: { monthDay: 3 } });
    expect(parse("Pay rent monthly")).toEqual({ text: "Pay rent", repeat: { monthDay: 4 } });
    expect(parse("Pay rent every month 15 nov")).toEqual({ text: "Pay rent", date: "2026-11-15", repeat: { monthDay: 15 } });
    expect(parse("Meet on the roof")).toEqual({ text: "Meet on the roof" });
    expect(parse("Meet on the 45th")).toEqual({ text: "Meet on the 45th" });
  });

  it("reads weekly and named weekdays", () => {
    expect(parse("Standup weekly")).toEqual({ text: "Standup", repeat: { days: [3] } });
    expect(parse("Standup weekly fri")).toEqual({ text: "Standup", date: "2026-11-06", repeat: { days: [5] } });
    expect(parse("Yoga every mon")).toEqual({ text: "Yoga", repeat: { days: [1] } });
    expect(parse("Yoga every mon thu 7am")).toEqual({ text: "Yoga", repeat: { days: [1, 4] }, start: 7 * 60 });
  });

  it("reads times a week", () => {
    for (const phrase of ["3x week", "3x/week", "3x a week", "3 times a week", "3 times per week", "3 x week", "3x wk"])
      expect(parse(`Run ${phrase}`)).toEqual({ text: "Run", repeat: { timesPerWeek: 3 } });
    expect(parse("Run twice a week")).toEqual({ text: "Run", repeat: { timesPerWeek: 2 } });
    expect(parse("Run 7x week")).toEqual({ text: "Run 7x week" });
    expect(parse("Buy 3x bolts")).toEqual({ text: "Buy 3x bolts" });
    expect(parse("Eat 3 times daily")).toEqual({ text: "Eat 3 times", daily: true });
  });

  it("takes custom tags, with spaces left out", () => {
    localStorage_addTag();
    expect(parse("Plan #deepwork")).toEqual({ text: "Plan", tag: expect.any(String) });
  });
});
