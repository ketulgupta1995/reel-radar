// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { act, fireEvent, render, screen, waitFor, configure, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addUpload, loadPosition, loadVoicePrefs, savePosition } from "@/lib/books";
import { loadRecording, setRecording } from "@/lib/booksDoc";
import { epubFile } from "@/test/epub";
import { pdfFile } from "@/test/pdf";
import { requests, routeFetch } from "@/test/pages";

const nav = vi.hoisted(() => ({ params: { id: "" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ useParams: () => nav.params }));

import BookPage from "./page";

// Reading an EPUB (build, hash, parse) is slow when the machine is busy, as it is under coverage.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

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

  it("opens a PDF into chapters of pages and plays it like an EPUB", async () => {
    const pages = Array.from({ length: 12 }, (_, i) => `Page ${i + 1} says hello.`);
    const { entry } = await addUpload(pdfFile(pages, { title: "Station Notes" }));
    nav.params.id = entry.id;
    render(<BookPage />);
    await screen.findByRole("heading", { name: "Station Notes" });
    await waitFor(() => expect(document.querySelector('[aria-current="true"]')).not.toBeNull());
    expect(screen.getByLabelText("Chapter text").textContent).toContain("Page 1 says hello.");
    expect(within(screen.getByLabelText("Chapter")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Pages 1–10", "Pages 11–12"]);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(said()).toEqual(["Page 1 says hello."]);
    finishSpeaking();
    expect(said()).toEqual(["Page 1 says hello.", "Page 2 says hello."]);
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    expect(screen.getByLabelText("Chapter text").textContent).toContain("Page 11 says hello.");
  });

  it("lists a PDF's outline entries as its chapters", async () => {
    const { entry } = await addUpload(pdfFile(["One says hi.", "Two says hi.", "Three says hi."], { title: "Outlined", outline: [{ title: "Beginning", page: 1 }, { title: "Ending", page: 3 }] }));
    nav.params.id = entry.id;
    render(<BookPage />);
    await screen.findByRole("heading", { name: "Outlined" });
    await waitFor(() => expect(within(screen.getByLabelText("Chapter")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Beginning", "Ending"]));
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    expect(screen.getByLabelText("Chapter text").textContent).toContain("Three says hi.");
  });

  it("reads a PDF without its running header and page numbers", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta"];
    const pagesWithFurniture = names.map((name, i) => [
      { text: "THE STATION CLOCK", y: 750 },
      { text: `${name} walked in.`, y: 600 },
      { text: `${name} sat down.`, y: 584 },
      { text: `${name} left.`, y: 568 },
      { text: `Page ${i + 1}`, y: 40 },
    ]);
    const { entry } = await addUpload(pdfFile(pagesWithFurniture, { title: "Furnished" }));
    nav.params.id = entry.id;
    render(<BookPage />);
    await screen.findByRole("heading", { name: "Furnished" });
    await waitFor(() => expect(sentence("Alpha walked in.")).toBeTruthy());
    const text = screen.getByLabelText("Chapter text").textContent ?? "";
    expect(text).not.toMatch(/STATION CLOCK|Page \d/);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(said()).toEqual(["Alpha walked in."]);
  });

  it("warns before Play that a two-column PDF may read out of order", async () => {
    const page = Array.from({ length: 14 }, (_, i) => [
      { text: `Left column line ${"a".repeat(i)}.`, y: 700 - i * 16, x: 72 },
      { text: `Right column line ${"b".repeat(i)}.`, y: 700 - i * 16, x: 330 },
    ]).flat();
    const { entry } = await addUpload(pdfFile([page, page, page], { title: "Columns" }));
    nav.params.id = entry.id;
    render(<BookPage />);
    await screen.findByRole("heading", { name: "Columns" });
    expect((await screen.findByRole("note")).textContent).toBe("This PDF looks like it has two columns, so it may read out of order.");
  });

  it("shows no warning for an ordinary book", async () => {
    await openUploaded();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("speaks a long PDF sentence with no punctuation in pieces under 1,000 characters, highlighting all of it", async () => {
    // Forty lines of one paragraph, about 3,000 characters with no comma or stop: one sentence.
    const words = Array.from({ length: 450 }, (_, i) => `word${i}`);
    const lines = Array.from({ length: 45 }, (_, i) => ({ text: words.slice(i * 10, i * 10 + 10).join(" "), y: 740 - i * 16 }));
    const long = words.join(" ");
    const { entry } = await addUpload(pdfFile([lines], { title: "Run on" }));
    nav.params.id = entry.id;
    render(<BookPage />);
    await screen.findByRole("heading", { name: "Run on" });
    await waitFor(() => expect(document.querySelector('[aria-current="true"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    for (let i = 0; i < 10 && said().join(" ").length < long.length; i++) finishSpeaking();
    expect(said().length).toBeGreaterThanOrEqual(4);
    expect(said().every((piece) => piece.length <= 1000)).toBe(true);
    expect(said().join(" ")).toBe(long);
    expect(sentence(long).getAttribute("aria-current")).toBe("true");
  });

  it("shows a PDF's text only as text", async () => {
    const { entry } = await addUpload(pdfFile(["<img src=x onerror=alert(1)> Hello there."], { title: "Plain" }));
    nav.params.id = entry.id;
    render(<BookPage />);
    await screen.findByRole("heading", { name: "Plain" });
    await waitFor(() => expect(sentence("<img src=x onerror=alert(1)> Hello there.")).toBeTruthy());
    expect(document.querySelector("img")).toBeNull();
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

describe("LibriVox recordings", () => {
  const SECTIONS = [
    { title: "Chapters 1-3", url: "https://www.archive.org/download/pp/1.mp3", seconds: 1132 },
    { title: "Chapters 4-6", url: "https://www.archive.org/download/pp/2.mp3", seconds: 1500 },
    { title: "Chapters 7-9", url: "https://www.archive.org/download/pp/3.mp3", seconds: 900 },
  ];
  const FOUND = {
    id: "253", title: "Pride and Prejudice", authors: ["Jane Austen"], language: "English", duration: "13:06:44",
    seconds: 47204, readers: ["Chris Goringe", "Ann"], sectionCount: SECTIONS.length,
  };
  let play: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof routeFetch>;

  beforeEach(() => {
    play = vi.fn(() => Promise.resolve());
    HTMLMediaElement.prototype.play = play as unknown as () => Promise<void>;
    HTMLMediaElement.prototype.pause = vi.fn();
    api = routeFetch({
      "/api/books/librivox": (url: URL) => ({ recordings: url.searchParams.has("id") ? [{ ...FOUND, sections: SECTIONS }] : [FOUND] }),
    });
  });

  const audio = () => document.querySelector("audio") as HTMLAudioElement;
  const section = () => (screen.getByLabelText("Section") as HTMLSelectElement).value;

  async function chooseRecording() {
    const view = await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    fireEvent.click(await screen.findByRole("button", { name: /Choose Pride and Prejudice, read by Chris Goringe, Ann/ }));
    await screen.findByLabelText("Section");
    return view;
  }

  it("finds recordings for the book, shows who read them, and plays the one you choose", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    await screen.findByText("Chris Goringe, Ann · 13 h 6 min · 3 sections");
    const search = requests(api, "/api/books/librivox")[0].url.searchParams;
    expect(search.get("title")).toBe("The Station Clock");
    expect(search.get("author")).toBe("A. Writer");

    fireEvent.click(screen.getByRole("button", { name: /Choose Pride and Prejudice/ }));
    await screen.findByLabelText("Section");
    expect(loadRecording(nav.params.id)).toEqual({ id: "253", title: "Pride and Prejudice" });
    expect(screen.getByRole("button", { name: "The recording" }).getAttribute("aria-pressed")).toBe("true");
    expect(audio().getAttribute("src")).toBe(SECTIONS[0].url);
    expect(screen.queryByLabelText("Chapter text")).toBeNull(); // the recording has no sentence timings
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("goes through the sections with the buttons, the list, and when one ends", async () => {
    await chooseRecording();
    expect((screen.getByRole("button", { name: "Previous section" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(section()).toBe("1");
    expect(audio().getAttribute("src")).toBe(SECTIONS[1].url);
    await waitFor(() => expect(loadPosition(nav.params.id)).toMatchObject({ chapter: 1 }));

    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "0" } });
    expect(audio().getAttribute("src")).toBe(SECTIONS[0].url);

    // Playing: the next section starts by itself when one ends, and the last one just stops.
    fireEvent.play(audio());
    fireEvent.ended(audio());
    expect(section()).toBe("1");
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent.ended(audio());
    expect(section()).toBe("2");
    expect((screen.getByRole("button", { name: "Next section" }) as HTMLButtonElement).disabled).toBe(true);
    play.mockClear();
    fireEvent.ended(audio());
    expect(section()).toBe("2");
    expect(play).not.toHaveBeenCalled();
  });

  it("doesn't start the next section by itself when you moved on while paused", async () => {
    await chooseRecording();
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(play).not.toHaveBeenCalled();
  });

  it("queues your place for syncing when you pause", async () => {
    await chooseRecording();
    localStorage.setItem("reel-radar-sync:books", JSON.stringify({ dirty: false }));
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    fireEvent.pause(audio());
    await waitFor(() => expect(JSON.parse(localStorage.getItem("reel-radar-sync:books")!).dirty).toBe(true));
  });

  it("plays at the speed you pick, which is remembered", async () => {
    await chooseRecording();
    fireEvent.click(screen.getByRole("button", { name: "1.5×" }));
    expect(audio().playbackRate).toBe(1.5);
    expect(screen.getByRole("button", { name: "1.5×" }).getAttribute("aria-pressed")).toBe("true");
    expect(loadVoicePrefs().rate).toBe(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(audio().playbackRate).toBe(1.5);
  });

  it("switches between the recording and the phone reading it, keeping the chapter", async () => {
    await chooseRecording();
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "2" } }); // three sections, two chapters
    fireEvent.click(screen.getByRole("button", { name: "Read aloud by the phone" }));
    expect(screen.getByLabelText("Chapter text")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Chapter") as HTMLSelectElement).value).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "The recording" }));
    await screen.findByLabelText("Section");
    expect(section()).toBe("1");
  });

  it("stops the phone's voice when you switch to the recording", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    fireEvent.click(await screen.findByRole("button", { name: /Choose Pride and Prejudice/ }));
    await screen.findByLabelText("Section");
    expect(synth.cancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read aloud by the phone" }));
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy(); // paused, not playing
  });

  it("remembers the recording and how you listen, and can remove it", async () => {
    const { unmount } = await chooseRecording();
    unmount();
    render(<BookPage />);
    await screen.findByRole("heading", { name: "The Station Clock" });
    await screen.findByLabelText("Section");

    fireEvent.click(screen.getByRole("button", { name: "Remove recording" }));
    expect(loadRecording(nav.params.id)).toBeNull();
    expect(screen.getByRole("button", { name: "Find a recording" })).toBeTruthy();
    expect(screen.getByLabelText("Chapter text")).toBeTruthy();
  });

  it("opens read aloud when you last used the phone's voice", async () => {
    const { id, unmount } = await chooseRecording();
    fireEvent.click(screen.getByRole("button", { name: "Read aloud by the phone" }));
    unmount();
    render(<BookPage />);
    await screen.findByRole("heading", { name: "The Station Clock" });
    expect(await screen.findByLabelText("Chapter text")).toBeTruthy();
    expect(screen.getByText("Pride and Prejudice")).toBeTruthy();
    expect(loadRecording(id)).not.toBeNull();
  });

  it("lets you change the recording", async () => {
    await chooseRecording();
    fireEvent.click(screen.getByRole("button", { name: "Change recording" }));
    await screen.findByRole("button", { name: /Choose Pride and Prejudice/ });
    expect(requests(api, "/api/books/librivox").filter((r) => r.url.searchParams.has("title"))).toHaveLength(2); // once to choose, once to change
  });

  it("says when there is no recording, and when LibriVox can't be reached", async () => {
    routeFetch({ "/api/books/librivox": { recordings: [] } });
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    await screen.findByText(/No recordings found/);

    routeFetch({ "/api/books/librivox": () => new Response(JSON.stringify({ error: "Couldn't reach LibriVox. Try again in a moment." }), { status: 502 }) });
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    await screen.findByText("Couldn't reach LibriVox. Try again in a moment.");
    expect(screen.queryByText(/No recordings found/)).toBeNull();
  });

  it("explains a recording that can't be loaded or played", async () => {
    await chooseRecording();
    fireEvent.error(audio());
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't be played/);
  });

  it("explains a recording whose sections can't be loaded", async () => {
    routeFetch({
      "/api/books/librivox": (url: URL) => (url.searchParams.has("id") ? new Response("{}", { status: 502 }) : { recordings: [FOUND] }),
    });
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    fireEvent.click(await screen.findByRole("button", { name: /Choose Pride and Prejudice/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't reach LibriVox/);

    routeFetch({ "/api/books/librivox": (url: URL) => ({ recordings: url.searchParams.has("id") ? [] : [FOUND] }) });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/no audio/));

    routeFetch({ "/api/books/librivox": (url: URL) => ({ recordings: [{ ...FOUND, ...(url.searchParams.has("id") && { sections: SECTIONS }) }] }) });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Section");
  });

  it("stays within a recording that has fewer sections than the place saved", async () => {
    routeFetch({
      "/api/books/librivox": (url: URL) => ({ recordings: [{ ...FOUND, ...(url.searchParams.has("id") && { sections: [SECTIONS[0]] }) }] }),
    });
    const { id } = await openUploaded();
    savePosition(id, 1, 0);
    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Find a recording" }));
    fireEvent.click(await screen.findByRole("button", { name: /Choose Pride and Prejudice/ }));
    await screen.findByLabelText("Section");
    expect(section()).toBe("0");
    await waitFor(() => expect(loadPosition(id)).toMatchObject({ chapter: 0 }));
  });

  it("shows a recording chosen on another device, and drops it when it is cleared there", async () => {
    const { id } = await openUploaded();
    expect(screen.getByRole("button", { name: "Find a recording" })).toBeTruthy();
    setRecording(id, { id: "253", title: "Pride and Prejudice" }); // as if it arrived by sync
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: ["books"] } })));
    await screen.findByText("Pride and Prejudice");
    expect(screen.getByLabelText("Chapter text")).toBeTruthy(); // still read aloud here until you switch

    fireEvent.click(screen.getByRole("button", { name: "The recording" }));
    await screen.findByLabelText("Section");
    setRecording(id, null);
    act(() => void window.dispatchEvent(new CustomEvent("reel-radar-sync", { detail: { keys: ["books"] } })));
    await waitFor(() => expect(screen.getByRole("button", { name: "Find a recording" })).toBeTruthy());
    expect(screen.getByLabelText("Chapter text")).toBeTruthy();
  });
});
