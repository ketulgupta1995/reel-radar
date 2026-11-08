// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { BUILTIN_LOG_ITEMS, MAX_LOG_ITEMS, MAX_TAGS, TAG_PALETTE, activeLogItems, activeTags, addGoal, addLogItem, addTag, allLogItems, allTags, moveLogItem, removeLogItem, renameLogItem, useLogItems, deleteGoal, deleteTemplate, loadGoals, loadTemplates, mergeSettings, removeTag, renameTag, restoreSettings, saveTemplate, setGoalDone, settingsBackup, tagColor, tagLabel, updateGoal, useGoals, useTags } from "./plannerSettings";
import { SYNC_EVENT, syncKeys } from "./sync";
import { jsonResponse } from "@/test/fixtures";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ docs: {} }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("tags", () => {
  it("starts with the six built-ins and stores nothing", () => {
    expect(activeTags().map((t) => t.label)).toEqual(["Work", "Home", "Health", "Personal", "Learning", "Errands"]);
    expect(tagColor("work")).toBe(TAG_PALETTE[0]);
    expect(settingsBackup().tags).toEqual([]);
  });

  it("adds a tag with the next free colour", () => {
    expect(addTag("  Deep work ")).toBeNull();
    const t = activeTags().find((x) => x.label === "Deep work")!;
    expect(t.color).toBe(TAG_PALETTE[6]);
    expect(tagLabel(t.id)).toBe("Deep work");
  });

  it("refuses blank and duplicate names, ignoring case and a leading #", () => {
    expect(addTag("   ")).toBe("Give the tag a name");
    expect(addTag("#")).toBe("Give the tag a name");
    expect(addTag("work")).toBe("There's already a work tag");
    expect(addTag("#WORK")).toBe("There's already a WORK tag");
  });

  it("stops at the number of colours that stay distinct, until one is removed", () => {
    addTag("One");
    addTag("Two");
    expect(activeTags()).toHaveLength(MAX_TAGS);
    expect(addTag("Three")).toMatch(/up to 8 tags/);
    removeTag("home");
    expect(addTag("Three")).toBeNull();
    expect(activeTags().find((t) => t.label === "Three")!.color).toBe(TAG_PALETTE[1]); // Home's freed colour
  });

  it("renames, keeping its id and colour", () => {
    expect(renameTag("work", "Job")).toBeNull();
    expect(tagLabel("work")).toBe("Job");
    expect(tagColor("work")).toBe(TAG_PALETTE[0]);
    expect(activeTags()).toHaveLength(6);
    expect(renameTag("work", "")).toBe("Give the tag a name");
    expect(renameTag("work", "home")).toBe("There's already a home tag");
    expect(renameTag("work", "JOB")).toBeNull(); // its own name, different case
    expect(renameTag("gone", "x")).toBe("That tag is gone");
  });

  it("shortens long names", () => {
    addTag("x".repeat(100));
    expect(activeTags().at(-1)!.label).toHaveLength(24);
  });

  it("keeps a removed tag's name and colour for old tasks, and brings it back by name", () => {
    removeTag("errands");
    expect(activeTags().map((t) => t.id)).not.toContain("errands");
    expect(allTags().map((t) => t.id)).toContain("errands");
    expect(tagLabel("errands")).toBe("Errands");
    expect(addTag("errands")).toBeNull();
    expect(activeTags().find((t) => t.id === "errands")!.removed).toBeUndefined();
    removeTag("gone"); // nothing to do
  });

  it("reads an unknown tag as a neutral one", () => {
    expect(tagLabel("old-import")).toBe("Other");
    expect(tagColor("old-import")).toMatch(/^rgba/);
  });

  it("survives an unreadable or partial stored doc", () => {
    localStorage.setItem("reel-radar-planner-settings", "not json");
    expect(activeTags()).toHaveLength(6);
    localStorage.setItem("reel-radar-planner-settings", "{}");
    expect(loadTemplates()).toEqual([]);
    localStorage.setItem("reel-radar-planner-settings", "null");
    expect(activeTags()).toHaveLength(6);
  });
});

describe("useTags", () => {
  const Show = () => <p>{useTags().map((t) => t.label).join(",")}</p>;

  it("follows changes made here and arriving from other devices", () => {
    render(<Show />);
    expect(screen.getByText(/^Work,/)).toBeTruthy();
    act(() => void renameTag("work", "Job"));
    expect(screen.getByText(/^Job,/)).toBeTruthy();
    act(() => {
      localStorage.setItem("reel-radar-planner-settings", JSON.stringify({ tags: [{ value: { id: "work", label: "Remote", color: "#3987e5" }, updatedAt: 9 }], templates: [] }));
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { keys: ["planner-settings"] } }));
    });
    expect(screen.getByText(/^Remote,/)).toBeTruthy();
  });
});

describe("templates", () => {
  const items = [{ text: "Standup", start: 570, duration: 15 }];

  it("saves, replaces by name, lists oldest first, and deletes", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000);
    saveTemplate("  Workday ", items);
    vi.setSystemTime(2000);
    saveTemplate("Weekend", []);
    vi.setSystemTime(3000);
    saveTemplate("WORKDAY", [{ text: "New" }]);
    vi.useRealTimers();
    expect(loadTemplates().map((t) => [t.name, t.items.length])).toEqual([["WORKDAY", 1], ["Weekend", 0]]);
    deleteTemplate(loadTemplates()[0].id);
    expect(loadTemplates().map((t) => t.name)).toEqual(["Weekend"]);
  });

  it("names a blank one, and shortens long names", () => {
    saveTemplate("  ", items);
    saveTemplate("y".repeat(99), items);
    expect(loadTemplates().map((t) => t.name.length)).toEqual(["Untitled day".length, 40]);
  });
});

describe("sync", () => {
  it("merges by item, with the later edit winning, and carries deletes", () => {
    const entry = (id: string, label: string, updatedAt: number) => ({ value: { id, label, color: "#3987e5" }, updatedAt });
    const base = { tags: [entry("a", "A", 1), entry("gone", "G", 1)], templates: [], goals: [] };
    const local = { tags: [entry("a", "Local", 5), entry("mine", "M", 2)], templates: [], goals: [] };
    const server = { tags: [entry("a", "Server", 3), entry("gone", "G", 1), entry("theirs", "T", 2)], templates: [], goals: [] };
    const merged = mergeSettings(local, server, base);
    expect(merged.tags.map((e) => e.value.label).sort()).toEqual(["Local", "M", "T"]);
    expect(mergeSettings({} as never, {} as never)).toEqual({ tags: [], templates: [], goals: [], logItems: [] });
  });

  it("is a synced doc that pushes after a change", async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ docs: { "planner-settings": { etag: '"e"', data: { tags: [{ value: { id: "home", label: "Casa", color: TAG_PALETTE[1] }, updatedAt: 1 }], templates: [] } } } }));
    await syncKeys(["planner-settings"], { force: true });
    expect(tagLabel("home")).toBe("Casa");
  });
});

describe("restoring from a backup", () => {
  it("treats it as untrusted", () => {
    const r = restoreSettings({
      tags: [
        { id: "ok", label: "Fine", color: TAG_PALETTE[2] },
        { id: "evil", label: "Bad colour", color: "url(javascript:alert(1))" },
        { id: "off", label: "Off", color: 5, removed: true },
        { id: "blank", label: "  " },
        { id: 3, label: "x" },
        null,
      ],
      templates: [
        {
          id: "t",
          name: "Day",
          createdAt: 5,
          items: [
            { text: "Good", start: 60, duration: 30, priority: "high", tag: "ok", note: "n", subtasks: ["a", 7] },
            { text: "Bad numbers", start: 99999, duration: "x", priority: "urgent", tag: 4, note: 9, subtasks: "no" },
            { text: "No length", start: 60 },
            { text: "" },
            null,
          ],
        },
        { id: "nocreated", name: "n".repeat(99), items: [] },
        { id: "noitems", name: "x" },
        null,
      ],
    });
    expect(r).toEqual({ tags: 3, templates: 2, goals: 0, logItems: 0 });
    expect(tagColor("evil")).toBe(TAG_PALETTE[0]);
    expect(allTags().find((t) => t.id === "off")).toMatchObject({ removed: true, color: TAG_PALETTE[0] });
    const day = loadTemplates().find((t) => t.id === "t")!;
    expect(day.items).toEqual([
      { text: "Good", start: 60, duration: 30, priority: "high", tag: "ok", note: "n", subtasks: ["a"] },
      { text: "Bad numbers" },
      { text: "No length", start: 60, duration: 60 },
    ]);
    expect(loadTemplates().find((t) => t.id === "nocreated")!.name).toHaveLength(40);
  });

  it("takes the backup's copy of the same id, and deletes nothing", () => {
    addTag("Keep");
    saveTemplate("Mine", []);
    restoreSettings({ tags: [{ id: "work", label: "Job", color: TAG_PALETTE[0] }], templates: [] });
    expect(tagLabel("work")).toBe("Job");
    expect(activeTags().map((t) => t.label)).toContain("Keep");
    expect(loadTemplates().map((t) => t.name)).toEqual(["Mine"]);
  });

  it("ignores a missing or misshapen section", () => {
    expect(restoreSettings(undefined)).toEqual({ tags: 0, templates: 0, goals: 0, logItems: 0 });
    expect(restoreSettings({ tags: "x", templates: 3, logItems: "no" })).toEqual({ tags: 0, templates: 0, goals: 0, logItems: 0 });
  });
});

describe("goals", () => {
  const only = () => loadGoals()[0];

  it("adds a goal, and says why it can't", () => {
    expect(addGoal("  ")).toBe("Give the goal a name");
    expect(addGoal(" Run 10K ", "2027-03-01")).toBeNull();
    expect(only()).toMatchObject({ name: "Run 10K", by: "2027-03-01" });
    expect(addGoal("run 10k")).toMatch(/already a goal/);
    setGoalDone(only().id, true);
    expect(addGoal("Run 10K")).toBeNull(); // an achieved goal can be set again
  });

  it("changes the name and date, and an empty date removes it", () => {
    addGoal("Run", "2027-03-01");
    updateGoal(only().id, { name: " Run far " });
    expect(only()).toMatchObject({ name: "Run far", by: "2027-03-01" });
    updateGoal(only().id, { name: " " });
    expect(only().name).toBe("Run far");
    updateGoal(only().id, { by: "" });
    expect(only().by).toBeUndefined();
    updateGoal("other", { name: "No" });
    expect(only().name).toBe("Run far");
  });

  it("marks one achieved, reopens it and deletes it", () => {
    addGoal("Run");
    addGoal("Read");
    const [run] = loadGoals();
    setGoalDone(run.id, true);
    expect(only().doneAt).toBeTypeOf("number");
    setGoalDone(run.id, false);
    expect(only().doneAt).toBeUndefined();
    deleteGoal(run.id);
    expect(loadGoals().map((g) => g.name)).toEqual(["Read"]);
  });

  it("merges goals by item and keeps them when tags change", () => {
    const goal = (id: string, updatedAt: number) => ({ value: { id, name: id, createdAt: 1 }, updatedAt });
    const merged = mergeSettings({ tags: [], templates: [], goals: [goal("mine", 2)] }, { tags: [], templates: [], goals: [goal("gone", 1), goal("theirs", 2)] }, { tags: [], templates: [], goals: [goal("gone", 1)] });
    expect(merged.goals.map((e) => e.value.id).sort()).toEqual(["mine", "theirs"]);
    addGoal("Run");
    addTag("Deep work");
    expect(only().name).toBe("Run");
  });

  it("restores well-formed goals from a backup and skips the rest", () => {
    addGoal("Here");
    const r = restoreSettings({
      goals: [{ id: "a", name: " Run ", by: "2027-01-01", doneAt: 5, createdAt: 9 }, { id: "b", name: "Bad date", by: "soon", doneAt: "x" }, { id: "c" }, { id: "d", name: " " }, null],
    });
    expect(r.goals).toBe(2);
    expect(loadGoals().find((g) => g.id === "a")).toEqual({ id: "a", name: "Run", by: "2027-01-01", doneAt: 5, createdAt: 9 });
    const bad = loadGoals().find((g) => g.id === "b")!;
    expect(bad.by).toBeUndefined();
    expect(bad.doneAt).toBeUndefined();
    expect(loadGoals().some((g) => g.name === "Here")).toBe(true);
    expect(settingsBackup().goals).toHaveLength(3);
  });

  it("useGoals starts empty, then follows changes", () => {
    addGoal("Run");
    const seen: string[][] = [];
    function Show() {
      const goals = useGoals();
      seen.push(goals.map((g) => g.name));
      return <p>{goals.map((g) => g.name).join()}</p>;
    }
    const { unmount } = render(<Show />);
    expect(seen[0]).toEqual([]);
    expect(screen.getByText("Run")).toBeTruthy();
    act(() => void addGoal("Read"));
    expect(screen.getByText("Run,Read")).toBeTruthy();
    unmount();
  });
});

describe("day log items", () => {
  const labels = () => activeLogItems().map((i) => i.label);

  it("starts with the seven built-ins, Walk counted in steps, and stores nothing", () => {
    expect(labels()).toEqual(["Bath", "Brush", "Stools", "Med 1", "Med 2", "Walk", "Yoga"]);
    expect(activeLogItems().find((i) => i.id === "walk")).toMatchObject({ kind: "number", unit: "steps" });
    expect(settingsBackup().logItems).toEqual([]);
  });

  it("adds at the end, and says why it can't", () => {
    expect(addLogItem("  Vitamins ", "tick")).toBeNull();
    expect(addLogItem("Water intake", "number")).toBeNull();
    expect(labels().slice(-2)).toEqual(["Vitamins", "Water intake"]);
    expect(activeLogItems().at(-1)!.kind).toBe("number");
    expect(addLogItem(" ", "tick")).toBe("Give the item a name");
    expect(addLogItem("bath", "tick")).toBe("There's already a bath item");
    for (let i = activeLogItems().length; i < MAX_LOG_ITEMS; i++) addLogItem(`Item ${i}`, "tick");
    expect(addLogItem("One more", "tick")).toMatch(/up to 20 items/);
  });

  it("renames, keeping its id", () => {
    expect(renameLogItem("med1", "Metformin")).toBeNull();
    expect(allLogItems().find((i) => i.id === "med1")!.label).toBe("Metformin");
    expect(renameLogItem("med1", "")).toBe("Give the item a name");
    expect(renameLogItem("med1", "Yoga")).toBe("There's already a Yoga item");
    expect(renameLogItem("gone", "x")).toBe("That item is gone");
  });

  it("reorders among the items in use, and stops at the ends", () => {
    moveLogItem("brush", -1);
    expect(labels().slice(0, 2)).toEqual(["Brush", "Bath"]);
    moveLogItem("brush", -1);
    moveLogItem("yoga", 1);
    expect(labels()[0]).toBe("Brush");
    expect(labels().at(-1)).toBe("Yoga");
    removeLogItem("walk");
    moveLogItem("yoga", -1); // skips the removed Walk
    expect(labels().slice(-2)).toEqual(["Yoga", "Med 2"]);
    moveLogItem("gone", 1);
  });

  it("keeps a removed item for its history, and brings it back by name and kind", () => {
    removeLogItem("yoga");
    expect(labels()).not.toContain("Yoga");
    expect(allLogItems().find((i) => i.id === "yoga")).toMatchObject({ removed: true });
    expect(addLogItem("YOGA", "number")).toBeNull(); // a different kind is a new item
    removeLogItem(activeLogItems().at(-1)!.id);
    expect(addLogItem("yoga", "tick")).toBeNull();
    const back = activeLogItems().find((i) => i.id === "yoga")!;
    expect(back.label).toBe("yoga");
    expect(back.removed).toBeUndefined();
    expect(labels().at(-1)).toBe("yoga"); // back at the end
    removeLogItem("gone");
  });

  it("merges by item with the newer edit winning, and keeps them from a doc that predates them", () => {
    const item = (label: string, updatedAt: number) => ({ value: { ...BUILTIN_LOG_ITEMS[0], label }, updatedAt });
    const merged = mergeSettings(
      { tags: [], templates: [], goals: [], logItems: [item("Shower", 5)] },
      { tags: [], templates: [], goals: [], logItems: [item("Bathe", 3)] }
    );
    expect(merged.logItems!.map((e) => e.value.label)).toEqual(["Shower"]);
    const kept = mergeSettings({ tags: [], templates: [], goals: [], logItems: [item("Shower", 5)] }, { tags: [], templates: [], goals: [] }, { tags: [], templates: [], goals: [] });
    expect(kept.logItems!.map((e) => e.value.label)).toEqual(["Shower"]);
  });

  it("reads an old stored doc without them as the built-ins", () => {
    localStorage.setItem("reel-radar-planner-settings", JSON.stringify({ tags: [], templates: [], goals: [] }));
    expect(labels()).toHaveLength(7);
    addTag("Deep work"); // saving the doc for another reason adds no items
    expect(settingsBackup().logItems).toEqual([]);
  });

  it("restores well-formed items from a backup and skips the rest", () => {
    const r = restoreSettings({
      logItems: [
        { id: "vit", label: " Vitamins ", kind: "tick", order: 9, unit: " pills " },
        { id: "bath", label: "Shower", kind: "tick", order: "x", removed: true },
        { id: "bad", label: "Bad", kind: "slider", order: 1 },
        { id: "blank", label: " ", kind: "tick" },
        { id: 4, label: "x", kind: "tick" },
        null,
      ],
    });
    expect(r.logItems).toBe(2);
    expect(allLogItems().find((i) => i.id === "vit")).toEqual({ id: "vit", label: "Vitamins", kind: "tick", order: 9, unit: "pills" });
    expect(allLogItems().find((i) => i.id === "bath")).toMatchObject({ label: "Shower", order: 0, removed: true });
    expect(settingsBackup().logItems.map((i) => i.id).sort()).toEqual(["bath", "vit"]);
  });

  it("useLogItems starts on the built-ins, then follows changes", () => {
    renameLogItem("bath", "Shower");
    function Probe() {
      return <p>{useLogItems().map((i) => i.label).join(",")}</p>;
    }
    render(<Probe />);
    expect(screen.getByText(/^Shower,Brush/)).toBeTruthy();
    act(() => {
      addLogItem("Floss", "tick");
    });
    expect(screen.getByText(/,Floss$/)).toBeTruthy();
    act(() => {
      localStorage.setItem("reel-radar-planner-settings", JSON.stringify({ tags: [], templates: [], goals: [] }));
      window.dispatchEvent(new Event(SYNC_EVENT));
    });
    expect(screen.getByText(/^Bath,Brush/)).toBeTruthy();
  });
});
