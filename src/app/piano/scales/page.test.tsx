// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { openSettings } from "@/test/stage";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { SCALES, scaleSongById } from "@/lib/pianoScales";
import { SongNote, handOf, songBeats, stepsOf } from "@/lib/pianoSongs";
import PianoLayout from "../layout";
import PianoHub from "../page";
import LogPage from "../log/page";
import ScalesPage from "./page";
import ScalePage from "./[id]/page";

let scaleId = "scale-c-major";
vi.mock("next/navigation", () => ({ usePathname: () => "/piano/scales", useParams: () => ({ id: scaleId }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

let midi: ReturnType<typeof fakeMidi>;
const open = async (ui = <ScalePage />) => {
  render(<PianoLayout>{ui}</PianoLayout>);
  await act(async () => {});
  openSettings(); // hands, mode and the ladder live in the stage's settings sheet
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const text = (id: string) => screen.getByTestId(id).textContent;
const key = (note: number) => {
  act(() => midi.noteOn(note));
  act(() => midi.noteOff(note));
};
const settings = () => JSON.parse(localStorage.getItem("reel-radar-piano-settings") || "{}");
const seedSongs = (songs: object) => localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs, updatedAt: 1 }));
const saved = () =>
  Object.entries(localStorage)
    .filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k))
    .flatMap(([, v]) => Object.values(JSON.parse(v).items)) as { drill: string; items: Record<string, { attempts: number; misses: number; avgMs: number }> }[];

const c = scaleSongById("scale-c-major")!;
const rh = handOf(c.notes, "R");

// A play-along run of the right hand at `bpm`, each note `off(i)` ms off its time.
const runAlong = (bpm: number, off: (i: number) => number) => {
  const beat = 60000 / bpm;
  const t0 = performance.now() + 60;
  click(/^Start|Play again/);
  rh.forEach((n: SongNote, i) => {
    const at = t0 + (4 + n.start) * beat + off(i);
    wait(Math.max(0, at - performance.now()));
    act(() => midi.noteOn(n.pitch, 100, at));
    act(() => midi.noteOff(n.pitch, at + 50));
  });
  wait(t0 + (4 + songBeats(c)) * beat + 400 - performance.now());
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  installFakeAudio();
  localStorage.clear();
  scaleId = "scale-c-major";
  midi = fakeMidi();
  midi.install();
  midi.plug();
});
afterEach(() => {
  uninstallMidi();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Scales list", () => {
  it("lists the scales in order, with only C open at first", async () => {
    await open(<ScalesPage />);
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/piano/scales/"));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/piano/scales/scale-c-major"]);
    expect(screen.getByTestId("locked-scale-g-major").textContent).toMatch(/Locked: finish C major with the right hand first/);
    expect(screen.getAllByRole("listitem")).toHaveLength(SCALES.length);
  });

  it("opens the next scale once the previous right hand is done, and shows both-hands status", async () => {
    seedSongs({ "scale-c-major": { step: 1, tempo: 50, best: 92, at: 1 } });
    await open(<ScalesPage />);
    expect(screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/piano/scales/"))).toHaveLength(2);
    expect(screen.getByTestId("locked-scale-f-major")).toBeTruthy();
    expect(text("hands-scale-c-major")).toBe("Right hand done · both hands open");
  });
});

describe("Scale player", () => {
  it("says so for an unknown scale", async () => {
    scaleId = "nope";
    await open();
    expect(screen.getByText(/isn't in the list/)).toBeTruthy();
  });

  it("opens with finger numbers and a crossing marker, and locks both hands", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "C major scale" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Falling notes" }).textContent).toContain("C1"); // letter + finger (thumb on C)
    const marks = screen.getAllByTestId("cross").map((e) => [e.getAttribute("data-cross"), e.textContent]);
    expect(marks).toContainEqual(["under", "thumb under"]);
    click("Start"); // the falling notes show what is coming: the finger-over note (coming down) appears later
    for (const n of rh.slice(0, 9)) key(n.pitch);
    expect(screen.getAllByTestId("cross").map((e) => [e.getAttribute("data-cross"), e.textContent])).toContainEqual(["over", "finger over"]);
    expect(screen.queryByRole("list", { name: "Hands ladder" })).toBeNull();
    expect((screen.getByRole("button", { name: "Both hands" }) as HTMLButtonElement).disabled).toBe(true);
    expect(text("scale-note")).toMatch(/Both hands open after a one-hand play-along run with at least 90%/);
    expect(screen.getByRole("link", { name: /Scales/ }).getAttribute("href")).toBe("/piano/scales");
  });

  it("accepts the right notes in order and rejects a wrong one", async () => {
    await open();
    click("Start");
    key(61); // wrong
    expect(text("misses")).toBe("Misses 1");
    expect(text("progress")).toBe("Step 1 of 15");
    key(60);
    key(62);
    key(64);
    expect(text("progress")).toBe("Step 4 of 15");
    key(67); // skipping ahead is wrong
    expect(text("misses")).toBe("Misses 2");
    for (const n of rh.slice(3)) key(n.pitch);
    expect(screen.getByRole("region", { name: "Song summary" })).toBeTruthy();
    expect(saved()).toEqual([expect.objectContaining({ drill: "scales", items: { "scale-c-major": expect.objectContaining({ attempts: 1, misses: 2 }) } })]);
  });

  it("scores a clean wait run for the right hand and counts the scale as started; no ladder prompt", async () => {
    await open();
    click("Start");
    for (const n of rh) key(n.pitch);
    expect(settings().songs["scale-c-major"]).toMatchObject({ step: 1 });
    expect(screen.queryByRole("button", { name: "Try next step" })).toBeNull();
  });

  it("shows the evenness of a play-along run, saves a 'scales' record, and opens both hands at 90%", async () => {
    await open();
    click("Play-along");
    const spreadOf = (i: number) => (i % 2 ? -20 : 20); // alternating +-20 ms around the beat
    runAlong(50, spreadOf);
    expect(text("pa-ontime")).toBe("100%");
    expect(text("pa-evenness")).toMatch(/Evenness: ±20 ms/);
    const [rec] = saved();
    expect(rec.drill).toBe("scales");
    expect(Object.keys(rec.items)).toEqual(["scale-c-major"]);
    expect(rec.items["scale-c-major"]).toMatchObject({ attempts: 1, misses: 0, avgMs: 20 });
    expect(settings().songs["scale-c-major"]).toMatchObject({ best: 100 });
    expect((screen.getByRole("button", { name: "Both hands" }) as HTMLButtonElement).disabled).toBe(false);
    expect(text("scale-note")).toMatch(/Both hands are open/);
    // Both hands: the two parts are one step each.
    click("Both hands");
    click("Wait");
    click("Start");
    expect(stepsOf(c)).toHaveLength(15);
    for (const st of stepsOf(c)) for (const n of st.notes) key(n.pitch);
  });

  it("keeps both hands locked after a play-along run under 90%", async () => {
    await open();
    click("Play-along");
    runAlong(50, (i) => (i < 5 ? 150 : 0)); // five notes far off
    expect(Number(text("pa-ontime")!.replace("%", ""))).toBeLessThan(90);
    expect((screen.getByRole("button", { name: "Both hands" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Scales around the app", () => {
  it("is linked from the Piano hub, with the coordination exercises", async () => {
    render(
      <PianoLayout>
        <PianoHub />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getByRole("link", { name: /Scales/ }).getAttribute("href")).toBe("/piano/scales");
    expect(screen.getByRole("link", { name: /Hand coordination/ }).getAttribute("href")).toBe("/piano/songs#coordination");
  });

  it("counts a scale session in the log (minutes, titled Scale) without a trend table", async () => {
    const at = new Date(2026, 10, 27, 8).getTime();
    localStorage.setItem(
      "reel-radar-piano-2026-11",
      JSON.stringify({ items: { s: { id: "s", kind: "drill", drill: "scales", startedAt: at, durationMs: 600_000, items: { "scale-c-major": { attempts: 1, misses: 2, slow: 0, avgMs: 20 } }, updatedAt: at } } }),
    );
    render(
      <PianoLayout>
        <LogPage />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getByTestId("today-minutes").textContent).toBe("10 min");
    expect(screen.getByTestId("streak").textContent).toBe("1 day");
    expect(screen.getByTestId("entry").textContent).toContain("Scale");
    expect(screen.queryByRole("table", { name: /Scale trend/ })).toBeNull();
  });
});
