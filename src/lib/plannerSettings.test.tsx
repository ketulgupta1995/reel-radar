// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MAX_TAGS, TAG_PALETTE, activeTags, addTag, allTags, deleteTemplate, loadTemplates, mergeSettings, removeTag, renameTag, restoreSettings, saveTemplate, settingsBackup, tagColor, tagLabel, useTags } from "./plannerSettings";
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
    const base = { tags: [entry("a", "A", 1), entry("gone", "G", 1)], templates: [] };
    const local = { tags: [entry("a", "Local", 5), entry("mine", "M", 2)], templates: [] };
    const server = { tags: [entry("a", "Server", 3), entry("gone", "G", 1), entry("theirs", "T", 2)], templates: [] };
    const merged = mergeSettings(local, server, base);
    expect(merged.tags.map((e) => e.value.label).sort()).toEqual(["Local", "M", "T"]);
    expect(mergeSettings({} as never, {} as never)).toEqual({ tags: [], templates: [] });
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
    expect(r).toEqual({ tags: 3, templates: 2 });
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
    expect(restoreSettings(undefined)).toEqual({ tags: 0, templates: 0 });
    expect(restoreSettings({ tags: "x", templates: 3 })).toEqual({ tags: 0, templates: 0 });
  });
});
