import { describe, expect, it } from "vitest";
import { searchNotes, searchTasks } from "./plannerSearch";
import type { DailyTask, Todo } from "./todos";

const todo = (id: string, extra: Partial<Todo> = {}): Todo => ({ id, text: id, completed: false, createdAt: "", ...extra });

describe("searchTasks", () => {
  it("finds nothing for an empty search", () => {
    expect(searchTasks("  ", { "2026-03-01": [todo("Gym")] }, [])).toEqual([]);
  });

  it("matches the title, note or checklist, any case, latest day first", () => {
    const hits = searchTasks(" DENTIST ", {
      "2026-03-01": [todo("Call dentist", { completed: true })],
      "2026-03-05": [todo("Errands", { note: "ask the dentist", completed: false })],
      "2026-03-03": [todo("Town", { subtasks: [{ id: "s", text: "Dentist forms", done: false }] }), todo("Gym")],
    }, []);
    expect(hits.map((h) => [h.text, h.date, h.completed])).toEqual([
      ["Errands", "2026-03-05", false],
      ["Town", "2026-03-03", false],
      ["Call dentist", "2026-03-01", true],
    ]);
    expect(hits[0].note).toBe("ask the dentist");
    expect(hits[1]).not.toHaveProperty("note");
  });

  it("gives a repeating task one row, saying how often and when it was last done", () => {
    const run: DailyTask = { id: "d", text: "Run", startDate: "2026-03-01", doneDates: ["2026-02-20"] };
    const hits = searchTasks("run", {
      "2026-03-01": [todo("Run", { dailyId: "d", completed: true })],
      "2026-03-02": [todo("Run", { dailyId: "d", completed: true, note: "old note" })],
      "2026-03-03": [todo("Run far", { dailyId: "d" })],
    }, [run]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ key: "d", text: "Run far", date: "2026-03-02", completed: true, repeat: { done: 3, last: "2026-03-02" } });
  });

  it("points a repeating task that was never done at its latest day", () => {
    expect(searchTasks("run", { "2026-03-01": [todo("Run", { dailyId: "d" })], "2026-03-02": [todo("Run", { dailyId: "d" })] }, [])[0]).toMatchObject({ date: "2026-03-02", completed: false, repeat: { done: 0, last: null } });
  });

  it("finds a repeating task with no copies yet", () => {
    const rent: DailyTask = { id: "d", text: "Pay rent", note: "landlord", startDate: "2026-03-15", monthDay: 1, subtasks: ["Transfer"] };
    expect(searchTasks("landlord", {}, [rent])[0]).toMatchObject({ text: "Pay rent", note: "landlord", date: "2026-03-15", repeat: { done: 0, last: null } });
    expect(searchTasks("transfer", {}, [rent])).toHaveLength(1);
    expect(searchTasks("zzz", {}, [rent, { id: "e", text: "Plain", startDate: "2026-03-15" }])).toEqual([]);
  });
});

describe("searchNotes", () => {
  it("finds day log reviews, latest first", () => {
    const logs = { "2026-03-01": { well: "Slept well", water: 500 }, "2026-03-03": { bad: "slept late", improve: "Other" } };
    expect(searchNotes("SLEPT", logs)).toEqual([
      { date: "2026-03-03", label: "Went badly", text: "slept late" },
      { date: "2026-03-01", label: "Went well", text: "Slept well" },
    ]);
    expect(searchNotes(" ", logs)).toEqual([]);
    expect(searchNotes("other", logs)[0].label).toBe("To improve");
  });
});
