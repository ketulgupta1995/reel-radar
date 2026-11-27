// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { loadSettings } from "@/lib/pianoData";
import { RHYTHM_ID } from "@/lib/pianoRhythm";
import { Plan, Step, plan } from "@/lib/pianoSession";
import { songById } from "@/lib/pianoSongLibrary";
import { handOf } from "@/lib/pianoSongs";
import { SessionState, newState, saveToday, sessionKey } from "@/lib/pianoSessionState";
import PianoLayout from "../layout";
import PracticePage from "./page";
import { TodayCard } from "./TodayCard";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/piano/practice", useRouter: () => ({ replace, push: vi.fn() }) }));

const PCS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOW = new Date(2026, 10, 27, 10, 0, 0);
let midi: ReturnType<typeof fakeMidi>;

const open = async () => {
  render(
    <PianoLayout>
      <PracticePage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const tap = (note: number) => {
  act(() => midi.noteOn(note, 100, performance.now()));
  act(() => midi.noteOff(note, performance.now()));
};
const target = () => screen.getByTestId("target").textContent!;
// Answers the five-finger step's current item (right hand C position at the first level).
const answerFinger = () => tap(60 + [0, 2, 4, 5, 7][Number(target()) - 1]);
const answerNote = () => tap(PCS.indexOf(target()) + 60);
const playSong = (id: string) => {
  for (const n of handOf(songById(id)!.notes, "R")) tap(n.pitch);
};
const records = () =>
  Object.entries(localStorage)
    .filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k))
    .flatMap(([, v]) => Object.values(JSON.parse(v).items)) as { drill: string; durationMs: number }[];
const stored = () => JSON.parse(localStorage.getItem(sessionKey("2026-11-27"))!) as SessionState;

beforeEach(() => {
  replace.mockClear();
  window.history.replaceState({}, "", "/piano/practice");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  installFakeAudio();
  localStorage.clear();
  midi = fakeMidi();
  midi.install();
  midi.plug();
});
afterEach(() => {
  cleanup();
  uninstallMidi();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const drillStep = (id: Step["id"], drill: string, minutes = 2): Step => ({ id, target: { kind: "drill", drill, minutes }, label: drill, why: "test" });
const custom = (steps: Step[]) => {
  const p: Plan = { steps: steps as Plan["steps"], alternates: [[], [], []] };
  saveToday(newState(p, NOW.getTime()));
};

describe("Today's practice runner", () => {
  it("shows the plan and a Start button, then runs three steps to the combined results", async () => {
    await open();
    const p = plan([], loadSettings(), NOW.getTime());
    expect(screen.getAllByTestId("plan-step")).toHaveLength(3);
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(stored().started).toBe(false);
    click("Start practice");

    // Step 1: five-finger warm-up, 2 minutes; the bar shows the three steps.
    expect(screen.getByTestId("stage")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Today's practice" }).querySelectorAll("li")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull(); // autoStart: no start screen
    answerFinger();
    wait(60_000);
    expect(screen.getByRole("list", { name: "Today's practice" }).querySelector("li")!.getAttribute("data-state")).toBe("now");
    wait(60_000);
    expect(stored()).toMatchObject({ index: 1, started: true });

    // Step 2: the weak spot (note drill here).
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull(); // no per-step results
    answerNote();
    wait(180_000);
    expect(stored().index).toBe(2);

    // Step 3: the song. A finished run starts another until 5 minutes have gone by.
    const song = songById((p.steps[2].target as { song: string }).song)!;
    playSong(song.id);
    expect(stored().index).toBe(2);
    expect(screen.getByRole("button", { name: "Finish step" })).toBeTruthy();
    wait(300_000);
    playSong(song.id); // the first run after the minutes are up ends the step
    expect(stored().index).toBe(3);

    // Results on the plain page.
    expect(screen.queryByTestId("stage")).toBeNull();
    const res = screen.getByRole("region", { name: "Results" });
    expect(within(res).getByRole("heading", { name: "Practice done" })).toBeTruthy();
    expect(within(res).getAllByTestId("result-card")).toHaveLength(3);
    expect(screen.getByTestId("today-line").textContent).toBe("Today 10 min, counts for the streak. Streak 1 day.");
    expect(within(res).getByRole("link", { name: "Done" }).getAttribute("href")).toBe("/piano");
    expect(within(res).getByRole("link", { name: "Keep going: free practice" }).getAttribute("href")).toBe("/piano/play");
    expect(records().map((r) => r.drill).sort()).toEqual(["fingers", "notes", "songs", "songs"]);

    // Opening again the same day shows the results; Practise again plans afresh.
    cleanup();
    await open();
    expect(screen.getAllByTestId("result-card")).toHaveLength(3);
    click("Practise again");
    expect(screen.getByRole("button", { name: "Start practice" })).toBeTruthy();
    expect(stored()).toMatchObject({ index: 0, started: false, cards: [] });
  });

  it("resumes at step 2 after a reload, starting that step from its beginning", async () => {
    await open();
    click("Start practice");
    answerFinger();
    wait(120_000);
    cleanup(); // reload
    await open();
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getByRole("button", { name: "Resume: step 2 of 3" })).toBeTruthy();
    expect(screen.getAllByTestId("plan-step")[0].getAttribute("data-done")).toBe("true");
    expect((screen.getByRole("button", { name: "Swap step 1" }) as HTMLButtonElement).disabled).toBe(true);
    click("Resume: step 2 of 3");
    expect(screen.getByTestId("stage")).toBeTruthy();
    expect(["C", "D", "E"]).toContain(target()); // the note drill's first group
  });

  it("pausing leaves the state at the step; the stage's back button goes to the hub", async () => {
    await open();
    click("Start practice");
    expect(screen.getByRole("link", { name: "Pause practice" }).getAttribute("href")).toBe("/piano");
    cleanup();
    await open();
    expect(screen.getByRole("button", { name: "Resume: step 1 of 3" })).toBeTruthy();
  });

  it("?start=1 runs step 1 at once and clears the flag; a reload shows the card", async () => {
    window.history.replaceState({}, "", "/piano/practice?start=1");
    await open();
    expect(screen.getByTestId("stage")).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/piano/practice");
    expect(stored()).toMatchObject({ started: true, index: 0 });
    cleanup();
    window.history.replaceState({}, "", "/piano/practice");
    await open();
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getByRole("button", { name: "Resume: step 1 of 3" })).toBeTruthy();
  });

  it("?start=1 on a finished day shows the results and clears the flag", async () => {
    const p = plan([], loadSettings(), NOW.getTime());
    saveToday({ ...newState(p, NOW.getTime()), started: true, index: 3, finished: ["warmup", "weak", "song"], cards: [{ kind: "drill", tag: "a", summary: {} as never }, { kind: "drill", tag: "b", summary: {} as never }, { kind: "drill", tag: "c", summary: {} as never }] });
    window.history.replaceState({}, "", "/piano/practice?start=1");
    await open();
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getAllByTestId("result-card")).toHaveLength(3);
    expect(replace).toHaveBeenCalledWith("/piano/practice");
  });

  it("Swap changes a step before starting and keeps the swap", async () => {
    await open();
    const before = screen.getAllByTestId("plan-step")[0].textContent;
    const label = stored().plan.steps[0].label;
    click("Swap step 1");
    const after = screen.getAllByTestId("plan-step")[0].textContent;
    expect(after).not.toBe(before);
    expect(stored().plan.steps[0].label).not.toBe(label);
    cleanup();
    await open();
    expect(screen.getAllByTestId("plan-step")[0].textContent).toBe(after);
  });

  it("removes other days' keys when today's is written", async () => {
    localStorage.setItem("reel-radar-piano-session-2026-11-26", "{}");
    await open();
    expect(localStorage.getItem("reel-radar-piano-session-2026-11-26")).toBeNull();
    expect(localStorage.getItem(sessionKey("2026-11-27"))).not.toBeNull();
  });

  it("replans when the stored session is broken", async () => {
    localStorage.setItem(sessionKey("2026-11-27"), "{oops");
    await open();
    expect(screen.getAllByTestId("plan-step")).toHaveLength(3);
  });

  it("runs a rhythm step and ends a drill step early with End round", async () => {
    custom([drillStep("warmup", RHYTHM_ID), drillStep("weak", "chords"), drillStep("song", "notes")]);
    await open();
    click("Start practice");
    expect(screen.getByRole("heading", { name: "Rhythm drill" })).toBeTruthy();
    click("End round");
    expect(stored().index).toBe(1);
    expect(stored().cards[0].kind).toBe("rhythm");
    click("End round"); // chords
    expect(stored().cards[1].kind).toBe("drill");
    click("End round"); // notes
    expect(stored().index).toBe(3);
    expect(screen.getAllByTestId("result-card")).toHaveLength(3);
  });

  it("lets a song step end early with Finish step, stopped runs leave the player idle", async () => {
    const song = songById("ode-to-joy")!;
    const p: Plan = {
      steps: [drillStep("warmup", "notes"), drillStep("weak", "chords"), { id: "song", target: { kind: "song", song: song.id, hands: "R", mode: "wait", tempo: 80, minutes: 5 }, label: "Ode", why: "t" }],
      alternates: [[], [], []],
    };
    saveToday({ ...newState(p, NOW.getTime()), started: true, index: 2, finished: ["warmup", "weak"], cards: [{ kind: "drill", tag: "a", summary: {} as never }, { kind: "drill", tag: "b", summary: {} as never }] });
    await open();
    click("Resume: step 3 of 3");
    tap(handOf(song.notes, "R")[0].pitch);
    click("Stop");
    expect(screen.getByRole("button", { name: "Play again" })).toBeTruthy();
    expect(stored().index).toBe(2); // a stopped run does not end the step
    click("Finish step");
    expect(stored().index).toBe(3);
    expect((stored().cards[2] as { result: { early: boolean } }).result.early).toBe(true);
  });

  it("Finish step during a wait run saves the run like Stop and ends the step", async () => {
    const song = songById("ode-to-joy")!;
    const p: Plan = {
      steps: [drillStep("warmup", "notes"), drillStep("weak", "chords"), { id: "song", target: { kind: "song", song: song.id, hands: "R", mode: "wait", tempo: 80, minutes: 5 }, label: "Ode", why: "t" }],
      alternates: [[], [], []],
    };
    saveToday({ ...newState(p, NOW.getTime()), started: true, index: 2, finished: ["warmup", "weak"], cards: [{ kind: "drill", tag: "a", summary: {} as never }, { kind: "drill", tag: "b", summary: {} as never }] });
    await open();
    click("Resume: step 3 of 3");
    const notes = handOf(song.notes, "R");
    tap(notes[0].pitch);
    tap(notes[1].pitch);
    wait(30_000);
    click("Finish step");
    expect(stored().index).toBe(3);
    expect(stored().cards[2]).toMatchObject({ kind: "song", result: { early: true, mode: "wait", wait: { played: 2 } } });
    expect(records()).toEqual([expect.objectContaining({ drill: "songs", durationMs: 30_000 })]);
  });

  it("finishing a song step before any run still gives a card, and an unknown song does not crash", async () => {
    const mk = (songId: string) => {
      const p: Plan = { steps: [drillStep("warmup", "notes"), drillStep("weak", "chords"), { id: "song", target: { kind: "song", song: songId, hands: "both", mode: "play", tempo: 70, minutes: 5 }, label: "Song", why: "t" }], alternates: [[], [], []] };
      saveToday({ ...newState(p, NOW.getTime()), started: true, index: 2, finished: ["warmup", "weak"], cards: [{ kind: "drill", tag: "a", summary: {} as never }, { kind: "drill", tag: "b", summary: {} as never }] });
    };
    mk("nope");
    await open();
    click("Resume: step 3 of 3");
    expect(screen.getByText("Song not found")).toBeTruthy();
    cleanup();
    mk("ode-to-joy");
    await open();
    click("Resume: step 3 of 3");
    click("Finish step"); // during the count-in: nothing played
    expect(stored().cards[2]).toMatchObject({ kind: "song", result: { early: true, mode: "play", hands: "both" } });
  });
});

describe("TodayCard", () => {
  it("disables Swap where there is no alternate and calls onStart in the tap", () => {
    const p: Plan = { steps: [drillStep("warmup", "notes"), drillStep("weak", "chords"), drillStep("song", "fingers")], alternates: [[], [drillStep("weak", "fingers")], []] };
    const onStart = vi.fn();
    const onSwap = vi.fn();
    render(<TodayCard state={newState(p, NOW.getTime())} onSwap={onSwap} onStart={onStart} />);
    expect((screen.getByRole("button", { name: "Swap step 1" }) as HTMLButtonElement).disabled).toBe(true);
    click("Swap step 2");
    expect(onSwap).toHaveBeenCalledWith(1);
    click("Start practice");
    expect(onStart).toHaveBeenCalled();
  });
});
