import { describe, expect, it } from "vitest";
import { computeGoalProgress, computeLogTrends, computeMonth, computePatterns, computeTimeFit, heatLevel, reviewWeek, sleepHours, suggestBlockLength } from "./plannerInsights";
import type { DailyTask, DayLog, Todo } from "./todos";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "", ...extra });

// 2026-03-02 is a Monday.
describe("sleepHours", () => {
  const M = "2026-03-01";
  const T = "2026-03-02";

  it("runs from the bedtime on the day before to this day's wake time", () => {
    expect(sleepHours({ [M]: { sleep: "23:00" }, [T]: { wake: "07:00" } }, T)).toBe(8);
  });

  it("treats a bedtime before noon as after midnight, on either day's log", () => {
    expect(sleepHours({ [M]: { sleep: "00:30" }, [T]: { wake: "07:00" } }, T)).toBe(6.5);
    expect(sleepHours({ [T]: { sleep: "01:00", wake: "07:00" } }, T)).toBe(6);
  });

  it("needs a wake time and a bedtime", () => {
    expect(sleepHours({ [M]: { sleep: "23:00" } }, T)).toBeNull();
    expect(sleepHours({ [T]: { wake: "07:00" } }, T)).toBeNull();
    expect(sleepHours({ [T]: { wake: "07:00", sleep: "23:00" } }, T)).toBeNull(); // that's tonight's
  });

  it("ignores impossible nights", () => {
    expect(sleepHours({ [M]: { sleep: "06:00" }, [T]: { wake: "07:00" } }, T)).toBeNull();
    expect(sleepHours({ [M]: { sleep: "12:00" }, [T]: { wake: "11:00" } }, T)).toBeNull();
  });
});

describe("computeLogTrends", () => {
  const logs: Record<string, DayLog> = {
    "2026-03-01": { sleep: "23:00", water: 2000, weight: 72 },
    "2026-03-02": { wake: "07:00", water: 3000, weight: 71 },
    "2026-03-03": { water: 100 },
    "2026-02-27": { water: 1000 },
  };

  it("averages per day, leaving a day still under way out of the water average", () => {
    const t = computeLogTrends(logs, "2026-03-01", "2026-03-03", false);
    expect(t.water.points.map((p) => p.value)).toEqual([2000, 3000, 100]);
    expect(t.water.average).toBe(2500);
    expect(t.sleep.points.map((p) => p.value)).toEqual([null, 8, null]);
    expect(t.sleep.average).toBe(8);
    expect(t.weight.average).toBe(71.5);
    expect(t.weightChange).toBe(-1);
  });

  it("compares with the period just before when asked", () => {
    expect(computeLogTrends(logs, "2026-03-01", "2026-03-03", true).water.previous).toBe(1000);
    expect(computeLogTrends(logs, "2026-03-01", "2026-03-03", false).water.previous).toBeNull();
    expect(computeLogTrends({}, "2026-03-01", "2026-03-03", true).water.previous).toBeNull();
  });

  it("groups long ranges into weeks and has nothing to say about empty ones", () => {
    const t = computeLogTrends(logs, "2026-01-05", "2026-03-03", false);
    expect(t.water.points[0]).toMatchObject({ start: "2026-01-05", end: "2026-01-11", value: null });
    expect(t.water.points.find((p) => p.start === "2026-02-23")).toMatchObject({ end: "2026-03-01", value: 1500 });
    expect(t.water.points[t.water.points.length - 1]).toMatchObject({ start: "2026-03-02", value: 1550 });
    const none = computeLogTrends({}, "2026-03-01", "2026-03-01", false);
    expect(none.weightChange).toBeNull();
    expect(none.water.average).toBeNull();
    expect(computeLogTrends({ "2026-03-01": { water: 500 } }, "2026-03-01", "2026-03-01", false).water.average).toBe(500); // a lone day still counts
  });

  it("starts a partial first week at the range's start", () => {
    const t = computeLogTrends({}, "2026-01-07", "2026-03-03", false);
    expect(t.water.points[0].start).toBe("2026-01-07");
  });
});

describe("computePatterns", () => {
  const days: Record<string, Todo[]> = {};
  const logs: Record<string, DayLog> = {};
  for (let i = 1; i <= 10; i++) {
    const d = `2026-03-${String(i).padStart(2, "0")}`;
    days[d] = [todo("a", { completed: i <= 5 }), todo("b", { completed: true })];
    logs[d] = { water: i <= 5 ? 3000 : 1000 };
  }

  it("compares completion across days that met the habit and days that didn't", () => {
    const water = computePatterns(days, logs, "2026-03-01", "2026-03-10").find((p) => p.id === "water")!;
    expect(water).toMatchObject({ enough: true, gap: 50, met: { days: 5, rate: 100 }, missed: { days: 5, rate: 50 } });
  });

  it("isn't enough with too few days on one side", () => {
    expect(computePatterns(days, logs, "2026-03-01", "2026-03-06").find((p) => p.id === "water")!.enough).toBe(false);
  });

  it("counts only days with both tasks and a log entry", () => {
    const sleep = computePatterns(days, { "2026-03-01": { sleep: "22:00" }, "2026-03-02": { wake: "07:00" } }, "2026-03-01", "2026-03-10").find((p) => p.id === "sleep")!;
    expect(sleep.met.days).toBe(1);
    expect(sleep.missed.days).toBe(0);
    const noTasks = computePatterns({}, logs, "2026-03-01", "2026-03-10").find((p) => p.id === "water")!;
    expect(noTasks.met).toMatchObject({ days: 0, rate: 0 });
  });
});

describe("computeTimeFit", () => {
  const done = (id: string, spent: number, duration?: number, tag: Todo["tag"] = "work") => todo(id, { tag, start: 540, duration, spent, completed: true });
  const D = "2026-03-02";

  it("needs a few finished, timed blocks per tag", () => {
    expect(computeTimeFit({ [D]: [done("a", 80), done("b", 80)] }, D, D)).toEqual([]);
    expect(
      computeTimeFit({ [D]: [done("a", 80, 60), done("b", 80, 60), todo("open", { tag: "work", start: 1, duration: 60, spent: 80 }), todo("noblock", { tag: "work", spent: 80, completed: true }), todo("notimer", { tag: "work", start: 1, duration: 60, completed: true })] }, D, D)
    ).toEqual([]);
  });

  it("works out how far off a tag runs and a realistic length", () => {
    const [fit] = computeTimeFit({ [D]: [done("a", 84, 60), done("b", 42, 30), done("c", 84, 60)] }, D, D);
    expect(fit).toEqual({ tag: "work", tasks: 3, planned: 150, actual: 210, overBy: 40, typical: 60, suggested: 85 });
  });

  it("assumes the default length, leaves out forgotten or late timers, and sorts by tasks", () => {
    const fits = computeTimeFit(
      {
        [D]: [
          done("a", 60), done("b", 60), done("c", 60), done("forgot", 400, 60), done("late", 5, 60),
          done("h1", 60, 60, "home"), done("h2", 60, 60, "home"), done("h3", 60, 60, "home"), done("h4", 60, 60, "home"),
        ],
      },
      D,
      D
    );
    expect(fits.map((f) => [f.tag, f.tasks, f.overBy])).toEqual([["home", 4, 0], ["work", 3, 0]]);
    expect(computeTimeFit({ [D]: [done("a", 60)] }, "2026-03-03", "2026-03-04")).toEqual([]);
  });
});

describe("suggestBlockLength", () => {
  const fit = (overBy: number, actual: number) => ({ tag: "work" as const, tasks: 3, planned: 100, actual, overBy, typical: 60, suggested: 60 });

  it("scales the block by how far that tag runs off", () => {
    expect(suggestBlockLength([fit(40, 140)], "work", 30)).toEqual({ overBy: 40, minutes: 40 });
    expect(suggestBlockLength([fit(-50, 50)], "work", 60)).toEqual({ overBy: -50, minutes: 30 });
  });

  it("stays quiet when it's close, unknown, or already that length", () => {
    expect(suggestBlockLength([fit(5, 105)], "work", 60)).toBeNull();
    expect(suggestBlockLength([fit(40, 140)], "home", 60)).toBeNull();
    expect(suggestBlockLength([fit(10, 101)], "work", 60)).toBeNull();
    expect(suggestBlockLength([{ ...fit(40, 140), tag: null }], undefined, 60)).toEqual({ overBy: 40, minutes: 85 });
  });

  it("keeps a suggestion within sensible bounds", () => {
    expect(suggestBlockLength([fit(300, 400)], "work", 300)!.minutes).toBe(720);
    expect(suggestBlockLength([fit(-75, 25)], "work", 5)).toBeNull();
  });
});

describe("reviewWeek", () => {
  it("on a Sunday covers the week ending today and all of next week", () => {
    const w = reviewWeek("2026-03-08");
    expect(w).toMatchObject({ start: "2026-03-02", end: "2026-03-08" });
    expect(w.next).toEqual(["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"]);
  });

  it("on other days covers the week that ended, and only what's left of this one", () => {
    const w = reviewWeek("2026-03-11"); // a Wednesday
    expect(w).toMatchObject({ start: "2026-03-02", end: "2026-03-08" });
    expect(w.next).toEqual(["2026-03-11", "2026-03-12", "2026-03-13", "2026-03-14", "2026-03-15"]);
  });
});

describe("computeMonth", () => {
  it("lists every day, totals what was finished and finds the best day", () => {
    const m = computeMonth(
      {
        "2026-02-03": [todo("a", { completed: true }), todo("b")],
        "2026-02-10": [todo("c", { completed: true }), todo("d", { completed: true })],
        "2026-03-01": [todo("e", { completed: true })],
      },
      [],
      "2026-02"
    );
    expect(m.days).toHaveLength(28);
    expect(m.days[2]).toEqual({ date: "2026-02-03", done: 1, total: 2 });
    expect(m).toMatchObject({ done: 3, activeDays: 2, best: { date: "2026-02-10", done: 2 } });
  });

  it("counts a repeating task's cleared copy, once", () => {
    const daily = [{ id: "d", text: "Run", startDate: "2026-01-01", doneDates: ["2026-02-05", "2026-02-06"] }];
    const m = computeMonth({ "2026-02-06": [todo("copy", { dailyId: "d", completed: true })] }, daily, "2026-02");
    expect(m.days[4]).toMatchObject({ done: 1, total: 1 });
    expect(m.days[5]).toMatchObject({ done: 1, total: 1 });
  });

  it("has no best day in an empty month", () => {
    expect(computeMonth({}, [], "2026-02")).toMatchObject({ done: 0, activeDays: 0, best: null });
  });
});

describe("heatLevel", () => {
  it("uses fixed steps", () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 30].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("computeGoalProgress", () => {
  const WEEK = ["2026-03-02", "2026-03-08"] as const;
  const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

  it("is empty for a goal with nothing linked", () => {
    expect(computeGoalProgress("g", { "2026-03-02": [todo("Other", { goalId: "h" })] }, [], ...WEEK)).toEqual({ done: 0, doneInRange: 0, percent: null, open: [], repeats: [], focused: 0, lastDone: null });
  });

  it("counts one-off tasks, on the day they were finished, with the earliest open one first", () => {
    const p = computeGoalProgress(
      "g",
      {
        "2026-03-01": [todo("Moved late", { goalId: "g", completed: true, doneAt: noon(2026, 3, 3), spent: 20 })],
        "2026-03-09": [todo("Later", { goalId: "g" })],
        "2026-03-04": [todo("Sooner", { goalId: "g" }), todo("No stamp", { goalId: "g", completed: true })],
        "2026-02-01": [todo("Old", { goalId: "g", completed: true, spent: 10 })],
      },
      [],
      ...WEEK
    );
    expect(p.done).toBe(3);
    expect(p.doneInRange).toBe(2);
    expect(p.percent).toBe(60);
    expect(p.open.map((s) => s.todo.text)).toEqual(["Sooner", "Later"]);
    expect(p.focused).toBe(30);
    expect(p.lastDone).toBe("2026-03-04");
  });

  it("counts every finished copy of a repeat, cleared ones and those from before the link too, but not missed ones", () => {
    const run: DailyTask = { id: "d", text: "Run", startDate: "2026-02-01", goalId: "g", doneDates: ["2026-03-05"] };
    const p = computeGoalProgress(
      "g",
      {
        "2026-03-02": [todo("Run", { dailyId: "d", completed: true })],
        "2026-03-03": [todo("Run", { dailyId: "d" })],
      },
      [run, { id: "x", text: "Other", startDate: "2026-02-01" }],
      ...WEEK
    );
    expect(p.done).toBe(2);
    expect(p.doneInRange).toBe(2);
    expect(p.percent).toBeNull(); // repeats have no end
    expect(p.open).toEqual([]);
    expect(p.repeats).toEqual([run]);
    expect(p.lastDone).toBe("2026-03-05");
  });

  it("still counts copies of a stopped repeat that carry the goal", () => {
    const p = computeGoalProgress("g", { "2026-03-02": [todo("Run", { dailyId: "gone", goalId: "g", completed: true }), todo("Run", { dailyId: "gone", goalId: "g" })] }, [], ...WEEK);
    expect(p.done).toBe(1);
    expect(p.open).toEqual([]);
  });
});
