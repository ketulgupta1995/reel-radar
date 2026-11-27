// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Plan, Step } from "./pianoSession";
import { SESSION_PREFIX, completeStep, isDone, loadToday, newState, saveToday, sessionKey, startLabel, withSwap } from "./pianoSessionState";

const step = (id: Step["id"]): Step => ({ id, target: { kind: "drill", drill: "notes", minutes: 2 }, label: id, why: "" });
const plan: Plan = { steps: [step("warmup"), step("weak"), step("song")], alternates: [[], [], []] };
const now = new Date(2026, 10, 27, 10).getTime();
const card = { kind: "drill" as const, tag: "x", summary: {} as never };

beforeEach(() => localStorage.clear());

describe("session state", () => {
  it("starts unstarted at step 1 with the local day", () => {
    const s = newState(plan, now);
    expect(s).toMatchObject({ day: "2026-11-27", started: false, index: 0, finished: [], cards: [] });
    expect(startLabel(s)).toBe("Start practice");
    expect(isDone(s)).toBe(false);
  });

  it("completing a step moves on and the label says Resume with the step number", () => {
    let s = completeStep(newState(plan, now), card);
    expect(s).toMatchObject({ started: true, index: 1, finished: ["warmup"] });
    expect(startLabel(s)).toBe("Resume: step 2 of 3");
    s = completeStep(completeStep(s, card), card);
    expect(isDone(s)).toBe(true);
    expect(s.cards).toHaveLength(3);
    expect(startLabel(s)).toBe("Resume: step 3 of 3");
  });

  it("withSwap replaces the plan only", () => {
    const next = { ...plan, alternates: [[step("warmup")], [], []] } as Plan;
    expect(withSwap(newState(plan, now), next).plan).toBe(next);
  });

  it("saves and loads today, and removes other days' keys", () => {
    localStorage.setItem(SESSION_PREFIX + "2026-11-26", "{}");
    localStorage.setItem("reel-radar-other", "keep");
    const s = newState(plan, now);
    saveToday(s);
    expect(localStorage.getItem(SESSION_PREFIX + "2026-11-26")).toBeNull();
    expect(localStorage.getItem("reel-radar-other")).toBe("keep");
    expect(loadToday(now)).toEqual(s);
    expect(loadToday(now + 86_400_000)).toBeNull();
  });

  it("ignores broken or foreign values", () => {
    for (const raw of ["not json", "null", "[]", JSON.stringify({ day: "2026-11-27" }), JSON.stringify({ ...newState(plan, now), index: 2 }), JSON.stringify({ ...newState(plan, now), index: 9 })]) {
      localStorage.setItem(sessionKey("2026-11-27"), raw);
      expect(loadToday(now)).toBeNull();
    }
    expect(loadToday(now - 1)).toBeNull(); // no key
  });
});
