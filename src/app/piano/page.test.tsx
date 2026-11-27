// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { saveDrillSettings, saveSession } from "@/lib/pianoData";
import { DrillRecord } from "@/lib/pianoDrill";
import { SessionState, completeStep, loadToday, newState, saveToday } from "@/lib/pianoSessionState";
import { plan } from "@/lib/pianoSession";
import { loadSettings } from "@/lib/pianoData";
import PianoLayout from "./layout";
import PianoHome from "./page";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/piano", useRouter: () => ({ push, replace: vi.fn() }) }));

const NOW = new Date(2026, 10, 27, 10, 0, 0);
const open = async () => {
  render(
    <PianoLayout>
      <PianoHome />
    </PianoLayout>,
  );
  await act(async () => {});
};
const rec = (drill: string, items: DrillRecord["items"], daysAgo = 0): DrillRecord => ({ id: `${drill}-${daysAgo}`, kind: "drill", drill, startedAt: NOW.getTime() - daysAgo * 86_400_000, durationMs: 120_000, items, updatedAt: 0 });
const card = { kind: "drill" as const, tag: "x", summary: {} as never };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  push.mockClear();
  installFakeAudio();
  fakeMidi().install();
});
afterEach(() => {
  cleanup();
  uninstallMidi();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Piano home", () => {
  it("shows the card, the meter, the Library and the tools, and says when the keyboard is missing", async () => {
    await open();
    expect(screen.getAllByTestId("plan-step")).toHaveLength(3);
    expect(screen.getByText(/Plug in your keyboard/)).toBeTruthy();
    expect(screen.getByTestId("teaser").textContent).toBe("Today 0 min of 10. Streak 0 days.");
    const lib = screen.getByRole("complementary", { name: "Library" });
    const href = (name: RegExp) => within(lib).getByRole("link", { name }).getAttribute("href");
    expect(href(/^Notes/)).toBe("/piano/notes");
    expect(href(/^Chords/)).toBe("/piano/chords");
    expect(href(/^Five fingers/)).toBe("/piano/fingers");
    expect(href(/^Rhythm/)).toBe("/piano/rhythm");
    expect(href(/^Songs/)).toBe("/piano/songs");
    expect(href(/^Scales & hands/)).toBe("/piano/scales");
    expect(href(/Free play/)).toBe("/piano/play");
    expect(href(/Metronome/)).toBe("/piano/metronome");
    expect(href(/Hand coordination/)).toBe("/piano/songs#coordination");
    expect(href(/Practice log/)).toBe("/piano/log");
    expect(within(lib).getByRole("link", { name: /^Notes/ }).textContent).toBe("NotesL1Not started");
    expect(screen.queryByRole("link", { name: /Start today/ })).toBeNull();
  });

  it("Library rows show levels and weak spots from the last 7 days", async () => {
    saveSession(rec("notes", { "F#": { attempts: 10, misses: 0, slow: 6, avgMs: 1800 }, Bb: { attempts: 10, misses: 0, slow: 3, avgMs: 1700 } }));
    saveSession(rec("chords", { G7: { attempts: 5, misses: 3, slow: 0, avgMs: 900 }, Eb: { attempts: 5, misses: 1, slow: 0, avgMs: 900 } }, 2));
    saveSession(rec("rhythm", {}, 4));
    saveDrillSettings("notes", { unlocked: 3, slowStep: 0 }, NOW.getTime());
    await open();
    const row = (name: RegExp) => screen.getByRole("link", { name }).textContent;
    expect(row(/^Notes/)).toBe("NotesL3Slow: F#, Bb");
    expect(row(/^Chords/)).toBe("ChordsL1Missed: G7, E♭");
    expect(row(/^Rhythm/)).toBe("RhythmL14 days ago");
  });

  it("Swap changes a step and keeps it", async () => {
    await open();
    const before = screen.getAllByTestId("plan-step")[0].textContent;
    fireEvent.click(screen.getByRole("button", { name: "Swap step 1" }));
    expect(screen.getAllByTestId("plan-step")[0].textContent).not.toBe(before);
    expect(loadToday(NOW.getTime())!.plan.steps[0].label).not.toBe(before);
    cleanup();
    await open();
    expect(screen.getAllByTestId("plan-step")[0].textContent).not.toBe(before);
  });

  it("Start opens the practice page with the start flag", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Start practice" }));
    expect(push).toHaveBeenCalledWith("/piano/practice?start=1");
  });

  it("says Resume with the step after a partial session", async () => {
    const s: SessionState = completeStep(newState(plan([], loadSettings(), NOW.getTime()), NOW.getTime()), card);
    saveToday(s);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Resume: step 2 of 3" }));
    expect(push).toHaveBeenCalledWith("/piano/practice?start=1");
    expect(screen.getAllByTestId("plan-step")[0].getAttribute("data-done")).toBe("true");
  });

  it("when today's practice is done, links to the results instead of Start", async () => {
    saveToday([card, card, card].reduce(completeStep, newState(plan([], loadSettings(), NOW.getTime()), NOW.getTime())));
    await open();
    expect(screen.queryByRole("button", { name: /Start|Resume/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Practice done today · see results" }).getAttribute("href")).toBe("/piano/practice");
    expect(screen.getAllByTestId("plan-step").every((l) => l.getAttribute("data-done") === "true")).toBe(true);
  });
});
