// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { act, fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addUpload, loadPosition, savePosition } from "@/lib/books";
import { epubFile } from "@/test/epub";
import { requests, routeFetch } from "@/test/pages";

const nav = vi.hoisted(() => ({ params: { id: "" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ useParams: () => nav.params }));

import BookPage from "./page";

// Reading an EPUB (build, hash, parse) is slow when the machine is busy, as it is under coverage.
configure({ asyncUtilTimeout: 5000 });

// A speech engine that speaks nothing, so each test decides when a sentence has been read out.
class FakeUtterance {
  lang = "";
  voice: unknown = null;
  rate = 1;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
const VOICES = [
  { name: "English India", lang: "en_IN", voiceURI: "in", localService: true },
  { name: "English US", lang: "en_US", voiceURI: "us", localService: true },
  { name: "Deutsch", lang: "de_DE", voiceURI: "de", localService: true },
];
const synth = {
  spoken: [] as FakeUtterance[],
  speak: vi.fn(),
  cancel: vi.fn(),
  getVoices: vi.fn(() => VOICES),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
const said = () => synth.spoken.map((u) => u.text);
const finishSpeaking = () => act(() => synth.spoken[synth.spoken.length - 1].onend?.());
const sentence = (text: string) => screen.getByRole("button", { name: text });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  routeFetch();
  synth.spoken = [];
  synth.speak.mockReset().mockImplementation((u: FakeUtterance) => synth.spoken.push(u));
  synth.cancel.mockReset();
  synth.getVoices.mockReset().mockReturnValue(VOICES);
  synth.addEventListener.mockReset();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", synth);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
});

async function openUploaded(options?: Parameters<typeof epubFile>[0]) {
  const { entry } = await addUpload(await epubFile(options));
  nav.params.id = entry.id;
  const view = render(<BookPage />);
  await screen.findByRole("heading", { name: "The Station Clock" });
  // The title can show before the chapter is loaded into the player; Play does nothing until it is.
  await waitFor(() => expect(document.querySelector('[aria-current="true"]')).not.toBeNull());
  return { id: entry.id, ...view };
}

describe("Book page", () => {
  it("shows the chapters and the text of the chosen chapter", async () => {
    await openUploaded();
    expect(screen.getByLabelText("Chapter text").textContent).toContain("Mr. Rao kept the clock fast.");
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    expect(screen.getByLabelText("Chapter text").textContent).toContain("She closed her book.");
    expect(screen.getByRole("link", { name: "← Library" }).getAttribute("href")).toBe("/books");
  });

  it("asks for the file again when it isn't on this device", async () => {
    nav.params.id = "0123456789abcdef";
    render(<BookPage />);
    await waitFor(() => expect(screen.getByText(/isn't on this device/)).toBeTruthy());
  });

  it("treats an unreadable file as missing", async () => {
    nav.params.id = "badbadbadbadbad0";
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("books", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
    });
    db.transaction("files", "readwrite").objectStore("files").put(new TextEncoder().encode("junk").buffer, nav.params.id);
    db.close();
    render(<BookPage />);
    await waitFor(() => expect(screen.getByText(/isn't on this device/)).toBeTruthy());
  });
});

describe("Player", () => {
  it("reads one sentence at a time, highlighting the one being read", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(said()).toEqual(["Chapter One"]);
    expect(sentence("Chapter One").getAttribute("aria-current")).toBe("true");

    finishSpeaking();
    expect(said()).toEqual(["Chapter One", "Mr. Rao kept the clock fast."]);
    expect(sentence("Mr. Rao kept the clock fast.").getAttribute("aria-current")).toBe("true");
    expect(sentence("Chapter One").getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("pauses at once, and playing again repeats that sentence", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    finishSpeaking();
    const cancelled = synth.cancel.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(synth.cancel.mock.calls.length).toBeGreaterThan(cancelled);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    const before = said().length;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(said().slice(before)).toEqual(["Mr. Rao kept the clock fast."]);
  });

  it("ignores the end of a sentence that was cancelled by a jump", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const cancelled = synth.spoken[0];
    fireEvent.click(sentence("Nobody argued."));
    expect(said()).toEqual(["Chapter One", "Nobody argued."]);
    act(() => cancelled.onend?.());
    expect(said()).toEqual(["Chapter One", "Nobody argued."]);
  });

  it("jumps with a tap, and with Back and Next, without speaking while paused", async () => {
    await openUploaded();
    fireEvent.click(sentence("Nobody argued."));
    expect(sentence("Nobody argued.").getAttribute("aria-current")).toBe("true");
    expect(said()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Previous sentence" }));
    expect(sentence("Mr. Rao kept the clock fast.").getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next sentence" }));
    expect(sentence("Nobody argued.").getAttribute("aria-current")).toBe("true");
  });

  it("carries on into the next chapter, then stops at the end of the book", async () => {
    await openUploaded({ chapters: [["One", ["First."]], ["Two", ["Second."]]] });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    finishSpeaking(); // "One"
    finishSpeaking(); // "First."
    await waitFor(() => expect(said()).toContain("Two"));
    expect((screen.getByLabelText("Chapter") as HTMLSelectElement).value).toBe("1");
    finishSpeaking();
    finishSpeaking(); // "Second."
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(said().at(-1)).toBe("Second.");
  });

  it("saves the position after every sentence and resumes from it", async () => {
    const { id, unmount } = await openUploaded();
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    fireEvent.click(sentence("The rain began at the far end."));
    await waitFor(() => expect(loadPosition(id)).toMatchObject({ chapter: 1, sentence: 1 }));
    unmount();

    render(<BookPage />);
    await screen.findByRole("heading", { name: "The Station Clock" });
    await waitFor(() => expect(sentence("The rain began at the far end.").getAttribute("aria-current")).toBe("true"));
    expect((screen.getByLabelText("Chapter") as HTMLSelectElement).value).toBe("1");
  });

  it("starts at the beginning when the saved chapter no longer exists", async () => {
    const { id, unmount } = await openUploaded();
    savePosition(id, 9, 4);
    unmount();
    render(<BookPage />);
    await screen.findByRole("heading", { name: "The Station Clock" });
    await waitFor(() => expect(sentence("Chapter One").getAttribute("aria-current")).toBe("true"));
  });

  it("speaks a very long sentence in smaller pieces, in order", async () => {
    const long = Array.from({ length: 80 }, (_, i) => `clause ${i} runs on for a while`).join(", ") + ".";
    await openUploaded({ chapters: [["", [long]]] });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(said()).toHaveLength(1);
    expect(said()[0].length).toBeLessThanOrEqual(1000);
    finishSpeaking();
    expect(said()).toHaveLength(2);
    finishSpeaking();
    expect(said().join(" ")).toContain("clause 79");
  });

  it("tries a failed sentence again, and stops with a message after repeated failures", async () => {
    await openUploaded();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(said()).toHaveLength(attempt);
      act(() => synth.spoken.at(-1)!.onerror?.({ error: "synthesis-failed" }));
      act(() => vi.advanceTimersByTime(600));
    }
    expect(said()).toEqual(["Chapter One", "Chapter One", "Chapter One"]);
    expect(screen.getByRole("alert").textContent).toMatch(/speech engine stopped/);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => synth.spoken.at(-1)!.onerror?.({ error: "interrupted" }));
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(said()).toHaveLength(4);
  });

  it("forgets earlier failures once a sentence is read", async () => {
    await openUploaded();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let i = 0; i < 2; i++) {
      act(() => synth.spoken.at(-1)!.onerror?.({ error: "synthesis-failed" }));
      act(() => vi.advanceTimersByTime(600));
    }
    finishSpeaking();
    for (let i = 0; i < 2; i++) {
      act(() => synth.spoken.at(-1)!.onerror?.({ error: "synthesis-failed" }));
      act(() => vi.advanceTimersByTime(600));
    }
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("treats a sentence that never finishes as a failure", async () => {
    await openUploaded();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => vi.advanceTimersByTime(8000));
    act(() => vi.advanceTimersByTime(600));
    expect(said()).toEqual(["Chapter One", "Chapter One"]);
  });

  it("pauses when the app goes to the background", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/background/);

    state.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); // it doesn't start by itself
    state.mockRestore();
  });

  it("offers a short English voice list and a speed, uses them, and remembers them", async () => {
    const { unmount } = await openUploaded();
    const voice = screen.getByLabelText("Voice") as HTMLSelectElement;
    expect([...voice.options].map((o) => o.textContent)).toEqual(["Phone default", "English US", "English India"]);

    fireEvent.change(voice, { target: { value: "in" } });
    fireEvent.click(screen.getByRole("button", { name: "1.5×" }));
    expect(screen.getByRole("button", { name: "1.5×" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(synth.spoken[0]).toMatchObject({ rate: 1.5, lang: "en-IN", voice: VOICES[0] });

    finishSpeaking(); // a speed change applies from the next sentence
    fireEvent.click(screen.getByRole("button", { name: "0.75×" }));
    expect(synth.spoken.at(-1)!.rate).toBe(1.5);
    finishSpeaking();
    expect(synth.spoken.at(-1)!.rate).toBe(0.75);
    unmount();

    render(<BookPage />);
    await screen.findByRole("heading", { name: "The Station Clock" });
    expect((screen.getByLabelText("Voice") as HTMLSelectElement).value).toBe("in");
    expect(screen.getByRole("button", { name: "0.75×" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(synth.spoken.at(-1)).toMatchObject({ lang: "en-US", voice: null });
  });

  it("picks up voices that the phone loads late", async () => {
    synth.getVoices.mockReturnValue([]);
    await openUploaded();
    expect((screen.getByLabelText("Voice") as HTMLSelectElement).options).toHaveLength(1);
    synth.getVoices.mockReturnValue(VOICES);
    const [event, reload] = synth.addEventListener.mock.calls[0];
    expect(event).toBe("voiceschanged");
    act(() => reload());
    expect((screen.getByLabelText("Voice") as HTMLSelectElement).options).toHaveLength(3);
  });

  it("scrolls the current sentence into view, even where scrollIntoView returns a Promise", async () => {
    const scroll = vi.fn(() => Promise.resolve());
    Element.prototype.scrollIntoView = scroll;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await openUploaded();
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      finishSpeaking();
      expect(scroll).toHaveBeenCalled();
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(/useEffect must not return/);
    } finally {
      errors.mockRestore();
      // @ts-expect-error jsdom has no scrollIntoView
      delete Element.prototype.scrollIntoView;
    }
  });

  it("tells you to open Chrome when the browser can't speak", async () => {
    // @ts-expect-error simulate a browser with no speech engine
    delete window.speechSynthesis;
    await openUploaded();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Open Books in Chrome/);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

describe("Keeping the screen on", () => {
  const sentinel = () => ({ release: vi.fn(() => Promise.resolve()) });
  afterEach(() => {
    // @ts-expect-error remove the fake wake lock
    delete navigator.wakeLock;
  });

  it("holds a screen lock only while playing, and asks again when the page comes back", async () => {
    const locks: ReturnType<typeof sentinel>[] = [];
    const request = vi.fn(async () => locks[locks.push(sentinel()) - 1]);
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    await openUploaded();
    expect(request).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(locks.at(-1)!.release).toHaveBeenCalled());
  });

  it("carries on listening when the phone refuses a lock or has no support", async () => {
    Object.defineProperty(navigator, "wakeLock", { value: { request: vi.fn(() => Promise.reject(new Error("low battery"))) }, configurable: true });
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(navigator.wakeLock.request).toHaveBeenCalled());
    expect(said()).toEqual(["Chapter One"]);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("lets go of a lock that arrives after playback stopped", async () => {
    const late = sentinel();
    let grant: (s: typeof late) => void = () => {};
    Object.defineProperty(navigator, "wakeLock", { value: { request: () => new Promise((r) => (grant = r)) }, configurable: true });
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => grant(late));
    expect(late.release).toHaveBeenCalled();
  });
});

describe("Keeping your place across devices", () => {
  const META = "reel-radar-sync:books";
  const dirty = () => JSON.parse(localStorage.getItem(META) || "{}").dirty === true;
  const settle = () => localStorage.setItem(META, JSON.stringify({ dirty: false }));

  it("queues the place for syncing when you pause, not after every sentence", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    settle();
    finishSpeaking();
    finishSpeaking();
    await waitFor(() => expect(loadPosition(nav.params.id)).toMatchObject({ sentence: 2 }));
    expect(dirty()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(dirty()).toBe(true));
  });

  it("queues the place when you change chapter", async () => {
    await openUploaded();
    settle();
    fireEvent.click(sentence("Nobody argued."));
    await waitFor(() => expect(loadPosition(nav.params.id)).toMatchObject({ sentence: 2 }));
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    await waitFor(() => expect(dirty()).toBe(true));
  });

  it("sends the place to the server when the page is hidden or closed", async () => {
    const fetch = routeFetch();
    await openUploaded();
    fireEvent.click(sentence("Nobody argued."));
    await waitFor(() => expect(loadPosition(nav.params.id)).toMatchObject({ sentence: 2 }));
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(requests(fetch, "/api/sync").some((r) => r.init?.method === "POST")).toBe(true));
    const posted = requests(fetch, "/api/sync").find((r) => r.init?.method === "POST")!;
    expect(JSON.parse(posted.init!.body as string)).toMatchObject({ key: "books" });
    state.mockRestore();

    fetch.mockClear();
    fireEvent.click(sentence("Mr. Rao kept the clock fast."));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    await waitFor(() => expect(requests(fetch, "/api/sync").some((r) => r.init?.method === "POST")).toBe(true));
  });

  it("sends the place when you leave the page", async () => {
    const fetch = routeFetch();
    const { unmount } = await openUploaded();
    fireEvent.click(sentence("Nobody argued."));
    await waitFor(() => expect(loadPosition(nav.params.id)).toMatchObject({ sentence: 2 }));
    fetch.mockClear();
    unmount();
    await waitFor(() => expect(requests(fetch, "/api/sync").some((r) => r.init?.method === "POST")).toBe(true));
  });

  const arrive = (position: { chapter: number; sentence: number }) => {
    const doc = JSON.parse(localStorage.getItem("reel-radar-books")!);
    doc.items[0] = { ...doc.items[0], position, updatedAt: Date.now() + 10_000 };
    localStorage.setItem("reel-radar-books", JSON.stringify(doc));
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: ["books"] } })));
  };

  it("follows a newer place from another device, in this chapter or another", async () => {
    await openUploaded();
    arrive({ chapter: 0, sentence: 2 });
    await waitFor(() => expect(sentence("Nobody argued.").getAttribute("aria-current")).toBe("true"));
    arrive({ chapter: 1, sentence: 1 });
    await waitFor(() => expect(sentence("The rain began at the far end.").getAttribute("aria-current")).toBe("true"));
    expect((screen.getByLabelText("Chapter") as HTMLSelectElement).value).toBe("1");
    arrive({ chapter: 1, sentence: 1 }); // already there: nothing to do
    expect(sentence("The rain began at the far end.").getAttribute("aria-current")).toBe("true");
  });

  it("doesn't move you while you are listening", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    arrive({ chapter: 1, sentence: 1 });
    expect(sentence("Chapter One").getAttribute("aria-current")).toBe("true");
    expect((screen.getByLabelText("Chapter") as HTMLSelectElement).value).toBe("0");
  });
});
