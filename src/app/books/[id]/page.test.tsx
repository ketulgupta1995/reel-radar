// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { act, fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addUpload, loadPosition, savePosition } from "@/lib/books";
import { epubFile } from "@/test/epub";

const nav = vi.hoisted(() => ({ params: { id: "" } as Record<string, string> }));
vi.mock("next/navigation", () => ({ useParams: () => nav.params }));

import BookPage from "./page";

// Reading an EPUB (build, hash, parse) is slow when the machine is busy, as it is under coverage.
configure({ asyncUtilTimeout: 5000 });

// A speech engine that speaks nothing, so each test decides when a sentence has been read out.
class FakeUtterance {
  lang = "";
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
const synth = { spoken: [] as FakeUtterance[], speak: vi.fn(), cancel: vi.fn() };
const said = () => synth.spoken.map((u) => u.text);
const finishSpeaking = () => act(() => synth.spoken[synth.spoken.length - 1].onend?.());
const sentence = (text: string) => screen.getByRole("button", { name: text });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  synth.spoken = [];
  synth.speak.mockReset().mockImplementation((u: FakeUtterance) => synth.spoken.push(u));
  synth.cancel.mockReset();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", synth);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
});

async function openUploaded(options?: Parameters<typeof epubFile>[0]) {
  const { entry } = await addUpload(await epubFile(options));
  nav.params.id = entry.id;
  const view = render(<BookPage />);
  await screen.findByRole("heading", { name: "The Station Clock" });
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

  it("stops with a message when the speech engine fails, and tries again on Play", async () => {
    await openUploaded();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => synth.spoken[0].onerror?.({ error: "synthesis-failed" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/speech engine stopped/);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => synth.spoken.at(-1)!.onerror?.({ error: "interrupted" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
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
