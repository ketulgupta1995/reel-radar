// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { requests, routeFetch } from "@/test/pages";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import PianoLayout from "../layout";
import NotesPage from "./page";
import { DrillRunner } from "../DrillRunner";
import { NOTE_DRILL } from "@/lib/pianoNoteDrill";

vi.mock("next/navigation", () => ({ usePathname: () => "/piano/notes" }));

const PCS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
let midi: ReturnType<typeof fakeMidi>;

const open = async () => {
  render(
    <PianoLayout>
      <NotesPage />
    </PianoLayout>,
  );
  await act(async () => {});
};
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const target = () => screen.getByTestId("target").textContent!;
// Press a note (octave 4 unless given) as the keyboard would, stamped on the performance clock.
const press = (name: string, octave = 4) => {
  act(() => midi.noteOn(PCS.indexOf(name) + 12 * (octave + 1), 100, performance.now()));
  act(() => midi.noteOff(PCS.indexOf(name) + 12 * (octave + 1), performance.now()));
};
const start = () => fireEvent.click(screen.getByRole("button", { name: /Start/ }));
const key = (n: string) => screen.getByLabelText(n);
const saved = () => Object.entries(localStorage).filter(([k]) => /^reel-radar-piano-\d{4}-\d{2}$/.test(k)).flatMap(([, v]) => Object.values(JSON.parse(v).items)) as {
  id: string;
  drill: string;
  durationMs: number;
  items: Record<string, { attempts: number; misses: number; slow: number; avgMs: number }>;
}[];
const settings = () => JSON.parse(localStorage.getItem("reel-radar-piano-settings") || "{}");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  installFakeAudio();
  localStorage.clear();
  midi = fakeMidi();
  midi.install();
  midi.plug();
});
afterEach(() => {
  uninstallMidi();
  vi.useRealTimers();
});

describe("Note drill page", () => {
  it("shows the unlock groups and starts nothing until asked", async () => {
    await open();
    expect(screen.getByText("Open: C D E")).toBeTruthy();
    expect(screen.getByText("Locked: F G")).toBeTruthy();
    expect(screen.getByText("Locked: C# D# F# G# A#")).toBeTruthy();
    expect(screen.getByText("Slow limit: 2 s")).toBeTruthy();
    expect(screen.queryByTestId("target")).toBeNull();
    expect(screen.getByRole("link", { name: "All drills" }).getAttribute("href")).toBe("/piano");
  });

  it("accepts any octave, hints after a miss or 2 s, and shows pressed versus wanted", async () => {
    await open();
    start();
    const first = target();
    expect(["C", "D", "E"]).toContain(first);
    expect(key("C4").getAttribute("data-state")).not.toBe("lit");
    expect(document.querySelectorAll('[data-state="lit"]')).toHaveLength(0);

    await wait(500);
    press(first, 2);
    const second = target();
    expect(second).not.toBe(first);

    const wrongName = ["C", "D", "E"].find((n) => n !== second)!;
    await wait(300);
    press(wrongName);
    expect(screen.getByRole("status", { name: "" }).textContent).toBe(`You pressed ${wrongName}4. Wanted ${second}.`);
    expect(target()).toBe(second);
    expect(key(`${second}4`).getAttribute("data-state")).toBe("lit");
    expect(key(`${second}3`).getAttribute("data-state")).toBe("lit");
    press(second);
    expect(document.querySelectorAll('[data-state="lit"]')).toHaveLength(0);
    expect(screen.queryByText(/You pressed/)).toBeNull();

    await wait(1900);
    expect(document.querySelectorAll('[data-state="lit"]')).toHaveLength(0);
    await wait(150);
    expect(document.querySelectorAll('[data-state="lit"]').length).toBeGreaterThan(0);
  });

  it("works from the on-screen keyboard too", async () => {
    await open();
    start();
    const t = target();
    fireEvent.pointerDown(key(`${t}4`));
    fireEvent.pointerUp(key(`${t}4`));
    expect(target()).not.toBe(t);
  });

  it("ends early, shows accuracy, reaction time and weakest notes, and saves the round", async () => {
    // Picks C, then D, then E: random picks could bring the first note back third (only back-to-back repeats are excluded).
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    await open();
    start();
    const a = target();
    await wait(400);
    press(a);
    const b = target();
    await wait(300);
    press(["C", "D", "E"].find((n) => n !== b)!); // miss b
    await wait(100);
    press(b);
    const c = target();
    await wait(2600); // slow
    press(c);
    fireEvent.click(screen.getByRole("button", { name: "End round" }));

    expect(screen.getByText("Round done")).toBeTruthy();
    expect(screen.getByTestId("accuracy").textContent).toBe("67%");
    expect(screen.getByTestId("reaction").textContent).toBe("1.50 s"); // (400 + 2600) / 2
    const weakest = screen.getByTestId("weakest").textContent!;
    expect(weakest).toContain(`${b}: 1 missed, 0 slow, of 1`);
    expect(weakest).toContain(`${c}: 0 missed, 1 slow, of 1`);

    const [rec] = saved();
    expect(saved()).toHaveLength(1);
    expect(rec).toMatchObject({ drill: "notes", durationMs: 3400 });
    expect(rec.id).toBeTruthy();
    expect(rec.items[a]).toMatchObject({ attempts: 1, misses: 0, slow: 0, avgMs: 400, ms: 400 });
    expect(rec.items[b]).toMatchObject({ misses: 1, ms: 0 }); // a miss adds no reaction time
    // The note-speed keyboard colours today's keys: a is fast, b (missed) and c (2.6 s) slow, the rest have no data.
    expect(screen.getByTestId(`key-${a}`).getAttribute("data-band")).toBe("fast");
    expect(screen.getByTestId(`key-${c}`).getAttribute("data-band")).toBe("slow");
    expect(screen.getByTestId(`key-${b}`).getAttribute("data-band")).toBe("slow");
    expect(screen.getByTestId("slow-line").textContent).toMatch(/ still slow: tomorrow/);
    expect(rec.items[b]).toMatchObject({ attempts: 1, misses: 1 });
    expect(rec.items[c]).toMatchObject({ attempts: 1, slow: 1, avgMs: 2600 });
    expect(localStorage.getItem("reel-radar-piano-2026-11")).toBeTruthy();
    expect(screen.queryByTestId("target")).toBeNull();
  });

  it("ends by itself after two minutes and saves it", async () => {
    await open();
    start();
    expect(screen.getByLabelText("Time left").textContent).toBe("2:00");
    await wait(500);
    press(target());
    await wait(60_000);
    expect(screen.getByLabelText("Time left").textContent).toBe("1:00");
    await wait(60_000);
    expect(screen.getByText("Round done")).toBeTruthy();
    expect(saved()).toHaveLength(1);
    expect(saved()[0].durationMs).toBe(120_000);
  });

  it("saves nothing for a round with no answers, and can run another", async () => {
    await open();
    start();
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(screen.getByText(/nothing was saved/)).toBeTruthy();
    expect(saved()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Another round" }));
    expect(screen.getByTestId("target")).toBeTruthy();
  });

  it("unlocks the next notes after a quick, accurate run, keeps them, and never goes back", async () => {
    await open();
    start();
    for (let i = 0; i < 20; i++) {
      await wait(1100);
      press(target());
    }
    expect(settings().unlocks.notes).toBe(2);
    expect(settings().slowSteps.notes).toBe(1); // median 1.1 s is under 1.5 s too
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(screen.getByText("Unlocked: F G")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Another round" }));
    for (let i = 0; i < 6; i++) {
      await wait(500);
      press("C#"); // mostly wrong, whatever is shown
    }
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(settings().unlocks.notes).toBe(2);
  });

  it("shows the saved unlock levels on a later visit", async () => {
    localStorage.setItem("reel-radar-piano-settings", JSON.stringify({ unlocks: { notes: 3 }, slowSteps: { notes: 2 }, updatedAt: 1 }));
    await open();
    expect(screen.getByText("Open: A B")).toBeTruthy();
    expect(screen.getByText("Locked: C# D# F# G# A#")).toBeTruthy();
    expect(screen.getByText("Slow limit: 1 s")).toBeTruthy();
  });

  it("keeps the screen on while the stage is open", async () => {
    const release = vi.fn();
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    const view = render(
      <PianoLayout>
        <NotesPage />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(request).toHaveBeenCalledWith("screen");
    view.unmount();
    await act(async () => {});
    expect(release).toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
  });

  it("shows the previous item with its time and the peeked next item, which then becomes the target", async () => {
    await open();
    start();
    expect(screen.getByTestId("previous").textContent).not.toMatch(/\d s/);
    const first = target();
    const next = screen.getByTestId("next").textContent!.replace("Next", "").trim();
    expect(["C", "D", "E"]).toContain(next);
    expect(next).not.toBe(first);
    await wait(700);
    press(first);
    expect(target()).toBe(next);
    expect(screen.getByTestId("previous").textContent).toContain(first);
    expect(screen.getByTestId("previous").textContent).toContain("0.7 s");
    const after = screen.getByTestId("next").textContent!.replace("Next", "").trim();
    expect(after).not.toBe(next);
  });

  it("runs a filtered, shorter round from props and reports it", async () => {
    const onFinish = vi.fn();
    render(
      <PianoLayout>
        <DrillRunner def={NOTE_DRILL} blurb="b" lengthMs={30_000} items={["C", "D", "E"]} onFinish={onFinish} top={<span>session bar</span>} />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Start 0:30 round" })).toBeTruthy();
    start();
    expect(screen.getByText("session bar")).toBeTruthy();
    expect(screen.getByLabelText("Time left").textContent).toBe("0:30");
    for (let i = 0; i < 25; i++) {
      await wait(1000);
      expect(["C", "D", "E"]).toContain(target());
      press(target());
    }
    expect(onFinish).not.toHaveBeenCalled();
    await wait(6000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    const [sum, rec] = onFinish.mock.calls[0];
    expect(sum.attempts).toBeGreaterThan(20);
    expect(rec.drill).toBe("notes");
    expect(saved()).toHaveLength(1);
    expect(saved()[0].durationMs).toBe(30_000);
    expect(settings().unlocks?.notes ?? 1).toBe(1); // 20+ quick answers on a filtered round unlock nothing
    expect(screen.getByText("Round done")).toBeTruthy();
  });

  it("hands the previous round's reaction to onFinish and, with showResults false, shows no results view", async () => {
    const onFinish = vi.fn();
    const view = render(
      <PianoLayout>
        <DrillRunner def={NOTE_DRILL} blurb="b" lengthMs={30_000} autoStart showResults={false} onFinish={onFinish} />
      </PianoLayout>,
    );
    await act(async () => {});
    await wait(800);
    press(target());
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(onFinish.mock.calls[0][2]).toBeNull(); // no earlier round
    expect(screen.queryByRole("region", { name: "Results" })).toBeNull();
    expect(screen.getByRole("button", { name: /Start/ })).toBeTruthy(); // back to the start screen
    view.unmount();
    render(
      <PianoLayout>
        <DrillRunner def={NOTE_DRILL} blurb="b" lengthMs={30_000} autoStart onFinish={onFinish} />
      </PianoLayout>,
    );
    await act(async () => {});
    await wait(1500);
    press(target());
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(onFinish.mock.calls[1][2]).toBe(800);
    expect(screen.getByTestId("reaction-vs").textContent).toBe("Slower than last round (was 0.8 s)");
  });

  it("starts straight away with autoStart, once", async () => {
    render(
      <PianoLayout>
        <DrillRunner def={NOTE_DRILL} blurb="b" lengthMs={60_000} autoStart />
      </PianoLayout>,
    );
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
    expect(screen.getByLabelText("Time left").textContent).toBe("1:00");
    expect(["C", "D", "E"]).toContain(target());
    fireEvent.click(screen.getByRole("button", { name: "End round" }));
    expect(screen.getByText("Round done")).toBeTruthy();
  });

  it("offers the keyboard messages in the settings sheet during a round", async () => {
    await open();
    start();
    act(() => midi.unplug());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("dialog").textContent).toContain("Plug in your keyboard");
  });

  it("weights this device's recent history: a note missed before is shown more", async () => {
    const now = Date.now();
    const rec = { id: "old", kind: "drill", drill: "notes", startedAt: now - 5 * 86_400_000, durationMs: 1, updatedAt: 1, items: { C: { attempts: 40, misses: 0, slow: 0, avgMs: 300 }, D: { attempts: 40, misses: 0, slow: 0, avgMs: 300 }, E: { attempts: 40, misses: 36, slow: 0, avgMs: 300 } } };
    localStorage.setItem("reel-radar-piano-2026-11", JSON.stringify({ items: { old: rec } }));
    let seed = 11;
    vi.spyOn(Math, "random").mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
    await open();
    start();
    const counts: Record<string, number> = { C: 0, D: 0, E: 0 };
    for (let i = 0; i < 18; i++) {
      counts[target()]++;
      await wait(2000);
      press(target());
    }
    expect(counts.E).toBeGreaterThan(counts.C);
    expect(counts.E).toBeGreaterThan(counts.D);
  });

  describe("sync", () => {
    const keysOf = (f: ReturnType<typeof routeFetch>) => requests(f, "/api/sync").filter((r) => !r.init?.method).map((r) => decodeURIComponent(r.url.searchParams.get("keys")!));
    const pushed = (f: ReturnType<typeof routeFetch>) => requests(f, "/api/sync").filter((r) => r.init?.method === "POST").map((r) => JSON.parse(r.init!.body as string).key as string).sort();

    it("pulls settings and this and last month on open, with nothing pushed", async () => {
      const f = routeFetch();
      await open();
      expect(keysOf(f)).toEqual(["piano-settings,piano-2026-11,piano-2026-10"]);
      await wait(10_000);
      expect(pushed(f)).toEqual([]);
    });

    it("pushes the month and settings a few seconds after a round ends, not per answer", async () => {
      const f = routeFetch();
      await open();
      start();
      press(target());
      await wait(500);
      press(target());
      await wait(5000);
      expect(pushed(f)).toEqual([]); // answers write nothing to the server
      fireEvent.click(screen.getByRole("button", { name: "End round" }));
      await wait(500);
      expect(pushed(f)).toEqual([]);
      await wait(3000);
      expect(pushed(f)).toEqual(["piano-2026-11", "piano-settings"]);
    });

    it("shows a session another device recorded", async () => {
      const server = { items: { x: { id: "x", kind: "drill", drill: "notes", startedAt: new Date(2026, 10, 20, 9).getTime(), durationMs: 1, updatedAt: 1, items: { C: { attempts: 20, misses: 0, slow: 0, avgMs: 500 } } } } };
      const f = routeFetch({ "/api/sync": (_u: URL, init?: RequestInit) => (init?.method === "POST" ? { etag: '"n"' } : { docs: { "piano-2026-11": { etag: '"m"', data: server } } }) });
      await open();
      expect(Object.keys(JSON.parse(localStorage.getItem("reel-radar-piano-2026-11")!).items)).toEqual(["x"]);
      expect(f).toHaveBeenCalled();
    });
  });
});
