// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { openSettings } from "@/test/stage";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { EXERCISES, exerciseById } from "@/lib/pianoExercises";
import { SONGS, songById } from "@/lib/pianoSongLibrary";
import { SongNote, handOf, songBeats, stepsOf } from "@/lib/pianoSongs";
import { HandChoice } from "@/lib/pianoSongs";
import PianoLayout from "../layout";
import SongsPage from "./page";
import SongPage from "./[id]/page";

let songId = "mary-had-a-little-lamb";
vi.mock("next/navigation", () => ({ usePathname: () => "/piano/songs", useParams: () => ({ id: songId }) }));

let midi: ReturnType<typeof fakeMidi>;
const open = async (ui = <SongPage />) => {
  render(<PianoLayout>{ui}</PianoLayout>);
  await act(async () => {});
  openSettings(); // hands, mode and the ladder live in the stage's settings sheet
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const progress = () => screen.getByTestId("progress").textContent;
const misses = () => screen.getByTestId("misses").textContent;
const key = (note: number) => {
  act(() => midi.noteOn(note));
  act(() => midi.noteOff(note));
};
const notesOut = () => midi.sent().filter((d) => d[0] === 0x90 && d[2] > 0).map((d) => d[1]);
const bars = () => screen.getAllByTestId("note").map((n) => ({ note: Number(n.getAttribute("data-note")), hand: n.getAttribute("data-hand"), current: n.getAttribute("data-current") === "true", expected: n.getAttribute("data-expected") === "true" }));
const saved = () =>
  Object.entries(localStorage)
    .filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k))
    .flatMap(([, v]) => Object.values(JSON.parse(v).items)) as { drill: string; durationMs: number; items: Record<string, { attempts: number; misses: number; slow: number; avgMs: number }> }[];

const mary = songById("mary-had-a-little-lamb")!;
const maryRh = handOf(mary.notes, "R").map((n) => n.pitch);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  installFakeAudio();
  localStorage.clear();
  songId = "mary-had-a-little-lamb";
  midi = fakeMidi();
  midi.install();
  midi.plug();
});
afterEach(() => {
  uninstallMidi();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Songs list", () => {
  it("lists every song, easiest first, with level badges", async () => {
    await open(<SongsPage />);
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/piano/songs/")).slice(0, SONGS.length); // the exercises follow
    expect(links).toHaveLength(SONGS.length);
    expect(links[0].getAttribute("href")).toBe("/piano/songs/mary-had-a-little-lamb");
    const levels = links.map((l) => Number(/Level (\d)/.exec(l.textContent!)![1]));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(screen.getByText("Für Elise (opening)")).toBeTruthy();
    expect(screen.getByTestId("chords-old-macdonald").textContent).toBe(" · melody + chords");
    expect(screen.queryByTestId("chords-mary-had-a-little-lamb")).toBeNull();
  });
});

describe("Song player, wait mode", () => {
  it("says so for an unknown song", async () => {
    songId = "nope";
    await open();
    expect(screen.getByText(/isn't in the list/)).toBeTruthy();
  });

  it("shows falling notes with letters and fingers, the hands in different colours, and waits to start", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Mary Had a Little Lamb" })).toBeTruthy();
    const first = bars().filter((b) => b.current);
    expect(first.map((b) => [b.note, b.hand])).toEqual([[48, "L"], [64, "R"]]);
    expect(screen.getByRole("img", { name: "Falling notes" }).textContent).toContain("E3"); // letter + finger
    const rects = screen.getAllByTestId("note").map((n) => n.querySelector("rect")!.getAttribute("class"));
    expect(new Set(rects.map((c) => /fill-\S+/.exec(c!)![0]))).toEqual(new Set(["fill-amber-400", "fill-sky-500"]));
    expect(notesOut()).toEqual([]); // nothing plays before Start
    expect(screen.queryByTestId("progress")).toBeNull();
  });

  it("advances only on the right key and counts wrong keys", async () => {
    await open();
    click("Start");
    expect(progress()).toBe(`Step 1 of ${maryRh.length}`);
    key(60); // wrong
    expect(progress()).toBe(`Step 1 of ${maryRh.length}`);
    expect(misses()).toBe("Misses 1");
    key(64); // E4: right
    expect(progress()).toBe(`Step 2 of ${maryRh.length}`);
    expect(misses()).toBe("Misses 1");
    key(62); // D4
    key(60); // C4
    expect(progress()).toBe(`Step 4 of ${maryRh.length}`);
    key(61); // wrong again, the song stays
    expect(misses()).toBe("Misses 2");
    expect(progress()).toBe(`Step 4 of ${maryRh.length}`);
  });

  it("plays the left hand for the app when the right hand is selected, and the right hand when the left is", async () => {
    await open();
    click("Start");
    expect(notesOut()).toEqual([48]); // LH C3 at step 1
    expect(bars().filter((b) => b.expected).map((b) => b.note)).toEqual([64]);
    click("Left hand"); // back to ready
    expect(screen.queryByTestId("progress")).toBeNull();
    midi.sent().length = 0;
    click("Start");
    expect(notesOut()).toEqual([64]); // the app plays the melody
    expect(bars().filter((b) => b.expected).map((b) => b.note)).toEqual([48]);
    key(48);
    expect(progress()).toBe("Step 2 of 26");
  });

  it("with both hands, the app plays nothing and a chord step needs every key", async () => {
    await open();
    click("Both hands");
    click("Start");
    expect(notesOut()).toEqual([]);
    expect(bars().filter((b) => b.expected).map((b) => b.note).sort()).toEqual([48, 64]);
    act(() => midi.noteOn(64));
    expect(progress()).toBe("Step 1 of 26");
    expect(misses()).toBe("Misses 0");
    act(() => midi.noteOn(48));
    expect(progress()).toBe("Step 2 of 26");
    act(() => midi.noteOff(64));
    act(() => midi.noteOff(48));
  });

  it("lets the app's hand carry a step the player has no notes on, at the song's tempo times the speed", async () => {
    await open();
    click("Left hand");
    fireEvent.change(screen.getByRole("slider", { name: "Speed" }), { target: { value: "50" } });
    expect(screen.getByTestId("speed").textContent).toBe("50%");
    click("Start");
    key(48); // step 2 is the right hand only
    expect(progress()).toBe("Step 2 of 26");
    expect(notesOut()).toEqual([64, 62]); // the app played E4, then D4 as its step began
    wait(600 * 2 - 1); // one beat at 100 BPM is 600 ms, doubled at half speed
    expect(progress()).toBe("Step 2 of 26");
    wait(1);
    expect(progress()).toBe("Step 3 of 26");
    expect(notesOut()).toEqual([64, 62, 60]);
  });

  it("finishes with a summary and saves a practice record", async () => {
    await open();
    click("Start");
    key(60); // one miss
    wait(65_000);
    for (const p of maryRh) key(p);
    const summary = screen.getByRole("region", { name: "Song summary" });
    expect(summary.textContent).toContain("Song finished");
    expect(screen.getByTestId("summary-misses").textContent).toBe("1");
    expect(screen.getByTestId("summary-time").textContent).toBe("1:05");
    expect(screen.getByTestId("summary-steps").textContent).toBe("26/26");
    expect(saved()).toEqual([expect.objectContaining({ drill: "songs", durationMs: 65_000, items: { "mary-had-a-little-lamb": { attempts: 1, misses: 1, slow: 0, avgMs: 0 } } })]);
    click("Play again");
    expect(progress()).toBe("Step 1 of 26");
  });

  it("finishes when the app plays the last step (left hand on a song that ends on the player's hand)", async () => {
    songId = "frere-jacques";
    await open();
    click("Left hand");
    click("Start");
    const f = songById("frere-jacques")!;
    const lh = handOf(f.notes, "L").map((n) => n.pitch);
    expect(lh.length).toBeGreaterThan(0);
    // The player plays each left-hand step; right-hand-only steps pass by themselves.
    const steps = stepsOf(f);
    for (let i = 0; i < steps.length; i++) {
      const mine = handOf(steps[i].notes, "L");
      if (mine.length) mine.forEach((n) => act(() => midi.noteOn(n.pitch)));
      else wait(60000); // the app's step
      if (screen.queryByRole("region", { name: "Song summary" })) break;
      mine.forEach((n) => act(() => midi.noteOff(n.pitch)));
    }
    expect(screen.getByRole("region", { name: "Song summary" }).textContent).toContain("Song finished");
    expect(saved()).toHaveLength(1);
  });

  it("saves a stopped run, but nothing when no step was played", async () => {
    await open();
    click("Start");
    click("Stop");
    expect(screen.getByRole("region", { name: "Song summary" }).textContent).toContain("Stopped");
    expect(saved()).toEqual([]);
    click("Play again");
    key(64);
    key(62);
    wait(30_000);
    click("Stop");
    expect(screen.getByTestId("summary-steps").textContent).toBe("2/26");
    expect(saved()).toEqual([expect.objectContaining({ drill: "songs", durationMs: 30_000 })]);
  });

  it("plays on the on-screen keyboard too", async () => {
    await open();
    click("Start");
    fireEvent.pointerDown(screen.getByRole("button", { name: "E4" }));
    fireEvent.pointerUp(screen.getByRole("button", { name: "E4" }));
    expect(progress()).toBe("Step 2 of 26");
  });
});

const settings = () => JSON.parse(localStorage.getItem("reel-radar-piano-settings") || "{}");
const maryProgress = () => settings().songs?.["mary-had-a-little-lamb"];
const seed = (p: object, id = "mary-had-a-little-lamb") => localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: { [id]: { at: 1, ...p } }, updatedAt: 1 }));
const grade = (n: SongNote) => screen.getAllByTestId("note").find((e) => e.getAttribute("data-note") === String(n.pitch) && e.getAttribute("data-hand") === n.hand && e.parentElement)!;
const text = (id: string) => screen.getByTestId(id).textContent;

// A play-along run at `bpm`: click Start, then press each of `hands`' notes at its time (offset(i, note) ms off,
// null = skipped), stamped as the keyboard would, and wait for the scoring.
const runAlong = (bpm: number, hands: HandChoice, offset: (i: number, n: SongNote) => number | null = () => 0, extra: (t0: number) => void = () => {}) => {
  const beat = 60000 / bpm;
  const t0 = performance.now() + 60;
  click(/^Start|Play again/);
  extra(t0);
  handOf(mary.notes, hands).forEach((n, i) => {
    const off = offset(i, n);
    if (off === null) return;
    const at = t0 + (4 + n.start) * beat + off;
    wait(Math.max(0, at - performance.now()));
    act(() => midi.noteOn(n.pitch, 100, at));
    act(() => midi.noteOff(n.pitch, at + 50));
  });
  wait(t0 + (4 + songBeats(mary)) * beat + 300 + 100 - performance.now());
  return t0;
};
const lhOut = () => midi.sent().flatMap((d, i) => (d[0] === 0x90 && d[2] > 0 ? [{ note: d[1], at: midi.sentTimes()[i] }] : []));
const finishWait = (hands: HandChoice) => {
  click("Start");
  for (const st of stepsOf(mary)) {
    const mine = handOf(st.notes, hands);
    mine.forEach((n) => act(() => midi.noteOn(n.pitch)));
    mine.forEach((n) => act(() => midi.noteOff(n.pitch)));
    if (!mine.length) wait(60000);
  }
};

describe("Song player, play-along", () => {
  it("counts in with clicks, plays the app's hand on schedule, scores the run and moves the tempo ladder up", async () => {
    await open();
    click("Play-along");
    expect(text("next-tempo")).toBe("Next run: 60 BPM");
    const rh = handOf(mary.notes, "R");
    const lh = handOf(mary.notes, "L");
    const t0 = performance.now() + 60;
    click("Start");
    wait(100);
    expect(text("progress")).toMatch(/Count-in/);
    expect(midi.sent().filter((d) => d[0] === 0x99).length).toBeGreaterThanOrEqual(1);
    wait(t0 + 3900 - performance.now()); // through the count-in bar: four clicks, nothing else yet
    expect(midi.sent().filter((d) => d[0] === 0x99)).toHaveLength(4);
    // The first note is played on time: it lights up green while the song goes on.
    wait(t0 + 4100 - performance.now());
    act(() => midi.noteOn(rh[0].pitch, 100, t0 + 4000 + 10));
    wait(50);
    expect(grade(rh[0]).getAttribute("data-grade")).toBe("on");
    expect(text("progress")).toMatch(/Bar 1/);
    // Finish the run: every right-hand note within 10 ms.
    rh.slice(1).forEach((n, i) => {
      const at = t0 + (4 + n.start) * 1000 + (i % 2 ? -10 : 10);
      wait(Math.max(0, at - performance.now()));
      act(() => midi.noteOn(n.pitch, 100, at));
      act(() => midi.noteOff(n.pitch, at + 50));
    });
    wait(t0 + (4 + songBeats(mary)) * 1000 + 400 - performance.now());
    const out = lhOut();
    expect(out.map((o) => o.note)).toEqual(lh.map((n) => n.pitch)); // the app played the left hand, and only it
    expect(out[0].at).toBe(t0 + 4000);
    expect(out[1].at).toBe(t0 + (4 + lh[1].start) * 1000);
    expect(midi.sent().filter((d) => d[0] === 0x99)).toHaveLength(4); // no clicks during the song unless asked
    const sum = screen.getByRole("region", { name: "Play-along summary" });
    expect(sum.textContent).toContain("Run done at 60 BPM");
    expect(text("pa-ontime")).toBe("100%");
    expect(text("pa-earlylate")).toBe("0 / 0");
    expect(text("pa-bars")).toMatch(/No bar was more than/);
    expect(text("song-line")).toBe("Ladder up: next time 65 BPM"); // the results card says what the ladder does
    expect(screen.queryByTestId("ladder-tempo")).toBeNull(); // and only it
    expect(text("next-tempo")).toBe("Next run: 65 BPM");
    expect(maryProgress()).toMatchObject({ step: 0, tempo: 65, best: 100 });
    const [rec] = saved();
    expect(rec.items["mary-had-a-little-lamb"]).toMatchObject({ attempts: 1, misses: 0, slow: 0 });
    expect(rec.items["mary-had-a-little-lamb"].avgMs).toBe(10); // mean absolute offset
  });

  it("shows early, late and missed notes, says where you rush and drag, and leaves the tempo when under 90%", async () => {
    await open();
    click("Play-along");
    const rh = handOf(mary.notes, "R");
    const lateIdx = 2; // bar 3 drags; the song's last note is skipped
    const firstBar = rh.filter((n) => n.start < 4);
    const lateBar = rh.filter((n) => Math.floor(n.start / 4) === lateIdx);
    runAlong(60, "R", (i, n) => (n === rh[rh.length - 1] ? null : n.start < 4 ? -130 : Math.floor(n.start / 4) === lateIdx ? 130 : 0), (t0) => {
      // a wrong key during the run
      wait(t0 + 8000 - performance.now());
      act(() => midi.noteOn(61, 100, t0 + 8000));
    });
    const sum = screen.getByRole("region", { name: "Play-along summary" });
    expect(sum).toBeTruthy();
    expect(text("pa-earlylate")).toBe(`${firstBar.length} / ${lateBar.length}`);
    expect(text("pa-missed")).toBe("1");
    expect(text("pa-bars")).toContain("You rush in bar 1 (-130 ms)");
    expect(text("pa-bars")).toContain(`and drag in bar ${lateIdx + 1} (+130 ms)`);
    expect(text("pa-bars")).toContain("1 extra key pressed");
    expect(text("pa-ontime")).toBe(`${Math.round(((rh.length - firstBar.length - lateBar.length - 1) / rh.length) * 100)}%`);
    expect(text("song-line")).toBe("Next time 60 BPM");
    expect(text("next-tempo")).toBe("Next run: 60 BPM");
    expect(maryProgress()).toMatchObject({ step: 0, tempo: 60, best: Number((text("pa-ontime") ?? "").replace("%", "")) }); // the best score is the only thing that moved
    const rec = saved()[0].items["mary-had-a-little-lamb"];
    expect(rec.misses).toBe(firstBar.length + lateBar.length + 1);
    expect(rec.avgMs).toBeGreaterThan(0);
  });

  it("clicks through the song when asked, and Stop ends the run without a record", async () => {
    await open();
    click("Play-along");
    fireEvent.click(screen.getByLabelText("Click during the song"));
    click("Start");
    wait(6600);
    expect(midi.sent().filter((d) => d[0] === 0x99).length).toBeGreaterThan(6);
    click("Stop");
    wait(60_000);
    expect(screen.queryByRole("region", { name: "Play-along summary" })).toBeNull();
    expect(saved()).toEqual([]);
    expect(midi.sent().filter((d) => d[0] === 0x99).length).toBeLessThan(12);
  });
});

describe("Song player, hands ladder and progress", () => {
  it("suggests the next step after a good run, the button switches hands and mode, and progress is saved", async () => {
    await open();
    const cur = () => screen.getAllByRole("listitem").filter((l) => l.getAttribute("data-current") === "true").map((l) => l.textContent);
    expect(cur()).toEqual(["1. Right hand, wait"]);
    finishWait("R");
    expect(screen.getByText(/Step done\. Next: left hand, wait\./)).toBeTruthy();
    expect(maryProgress()).toMatchObject({ step: 1 });
    expect(cur()).toEqual(["2. Left hand, wait"]);
    expect(within(screen.getByRole("list", { name: "Hands ladder" })).getAllByRole("listitem")[0].textContent).toBe("✓ Right hand, wait");
    fireEvent.click(screen.getByRole("button", { name: "Try next step" }));
    expect(screen.getByRole("button", { name: "Left hand" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Wait" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Try next step" })).toBeNull();
    // Finishing the same step again changes nothing, so nothing is written.
    finishWait("R");
    const before = localStorage.getItem("reel-radar-piano-settings");
    click("Right hand");
    finishWait("R");
    expect(localStorage.getItem("reel-radar-piano-settings")).toBe(before);
  });

  it("does not suggest a step after a run with many misses, or one stopped early", async () => {
    await open();
    click("Start");
    for (let i = 0; i < 4; i++) key(61);
    for (const p of maryRh) key(p);
    expect(screen.getByRole("region", { name: "Song summary" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try next step" })).toBeNull();
    click("Play again");
    key(64);
    click("Stop");
    expect(screen.queryByRole("button", { name: "Try next step" })).toBeNull();
    expect(maryProgress()).toBeUndefined();
  });

  it("reaches both hands at tempo, then calls the song mastered after a good run at full tempo", async () => {
    await open();
    click("Both hands");
    finishWait("both");
    expect(screen.getByText(/Next: both hands at tempo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try next step" }));
    expect(screen.getByRole("button", { name: "Play-along" }).getAttribute("aria-pressed")).toBe("true");
    expect(maryProgress().step).toBe(3);
    runAlong(60, "both");
    expect(text("song-line")).toBe("Ladder up: next time 65 BPM"); // not mastered: not at full tempo yet
    expect(text("next-tempo")).toBe("Next run: 65 BPM");
    expect(lhOut()).toEqual([]); // both hands: the app plays nothing
  });

  it("opens on the saved step; full tempo at 90% masters the song and the list shows it", async () => {
    seed({ step: 3, tempo: 100, best: 96 });
    await open();
    expect(screen.getByRole("button", { name: "Both hands" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Play-along" }).getAttribute("aria-pressed")).toBe("true");
    expect(text("next-tempo")).toBe("Next run: 100 BPM");
    expect(screen.getByText(/song tempo 100, best 96% on time/)).toBeTruthy();
    runAlong(100, "both", () => 20);
    expect(text("song-line")).toBe("Mastered: both hands at full tempo");
    expect(screen.queryByRole("button", { name: "Try next step" })).toBeNull();
    expect(maryProgress()).toMatchObject({ step: 3, tempo: 100, best: 100, mastered: true });
  });
});

describe("Songs list progress", () => {
  it("shows each song's step and best score, and nothing for songs not started", async () => {
    localStorage.setItem(
      "reel-radar-piano-settings",
      JSON.stringify({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], updatedAt: 1, songs: { "twinkle-twinkle": { step: 3, tempo: 100, best: 97, mastered: true, at: 1 }, "ode-to-joy": { step: 0, tempo: 60, best: 0, at: 1 } } }),
    );
    await open(<SongsPage />);
    expect(text("progress-twinkle-twinkle")).toBe("Mastered · best 97%");
    expect(text("progress-ode-to-joy")).toBe("Step 1 of 4: Right hand, wait");
    expect(screen.queryByTestId("progress-frere-jacques")).toBeNull();
  });

  it("lists a song's step and best", async () => {
    seed({ step: 1, tempo: 70, best: 93 });
    await open(<SongsPage />);
    expect(text("progress-mary-had-a-little-lamb")).toBe("Step 2 of 4: Left hand, wait · best 93%");
  });
});

describe("Coordination exercises", () => {
  it("lists the exercises in a Coordination section after the songs, easiest first", async () => {
    await open(<SongsPage />);
    const section = screen.getByRole("heading", { name: "Coordination" }).closest("section")!;
    const links = Array.from(section.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(EXERCISES.map((e) => `/piano/songs/${e.id}`));
    expect(screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/piano/songs/"))).toHaveLength(SONGS.length + EXERCISES.length);
  });

  it("opens an exercise in the player with the left hand held, and the hands ladder applies", async () => {
    songId = "coord-held-c";
    const ex = exerciseById("coord-held-c")!;
    await open();
    expect(screen.getByRole("heading", { name: "Held C, then C to G" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Hands ladder" }).textContent).toContain("Right hand, wait");
    // Right hand in wait mode: the app holds the left-hand C while the right hand plays its melody.
    click("Start");
    expect(notesOut()).toEqual([48]);
    for (const n of handOf(ex.notes, "R")) key(n.pitch);
    expect(screen.getByRole("region", { name: "Song summary" })).toBeTruthy();
    expect(screen.getByText(/Step done\. Next: left hand, wait\./)).toBeTruthy();
    expect(settings().songs["coord-held-c"]).toMatchObject({ step: 1 });
    expect(saved()).toEqual([expect.objectContaining({ drill: "songs", items: { "coord-held-c": expect.objectContaining({ attempts: 1, misses: 0 }) } })]);
    fireEvent.click(screen.getByRole("button", { name: "Try next step" }));
    expect(screen.getByRole("button", { name: "Left hand" }).getAttribute("aria-pressed")).toBe("true");
    click("Play-along");
    expect(text("next-tempo")).toBe("Next run: 50 BPM"); // the tempo ladder, from 60% of 80
  });
});
