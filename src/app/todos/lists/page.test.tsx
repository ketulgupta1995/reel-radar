// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { requests, routeFetch } from "@/test/pages";
import { jsonResponse } from "@/test/fixtures";
import { addItem, addList, getItem, loadItems, loadLists } from "@/lib/lists";
import { getTodayDate, loadTodos } from "@/lib/todos";

vi.mock("next/navigation", () => ({ usePathname: () => "/todos/lists" }));

import ListsPage from "./page";

const row = (text: string) => screen.getByText(text).closest("li") as HTMLElement;
const openRow = (text: string) => fireEvent.click(screen.getByText(text));
const photo = { id: "photo-0001", kind: "image" as const, mime: "image/jpeg", size: 10 };
const voice = { id: "voice-0001", kind: "voice" as const, mime: "audio/webm", size: 20, seconds: 65 };
const choosePhoto = (file: File) => fireEvent.change(screen.getByTestId("photo-input"), { target: { files: [file] } });
const jpeg = () => new File([new Uint8Array(20)], "shot.jpg", { type: "image/jpeg" });

// A stand-in MediaRecorder: start() records, stop() hands over one chunk.
function stubRecorder() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  class FakeRecorder {
    static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
    state = "inactive";
    mimeType: string;
    stream = stream;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_s: unknown, opts: { mimeType?: string }) {
      this.mimeType = opts.mimeType ?? "";
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([new Uint8Array(8)], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { getUserMedia, track };
}

describe("ListsPage", () => {
  it("starts with suggested lists and creates one", async () => {
    const fetch = routeFetch();
    render(<ListsPage />);
    expect(await screen.findByText("Start a list")).toBeTruthy();
    fireEvent.click(screen.getByText("🎁 Wishlist"));
    expect(loadLists()).toEqual([expect.objectContaining({ name: "Wishlist", icon: "🎁" })]);
    expect(screen.getByRole("heading", { name: /Wishlist/ })).toBeTruthy();
    expect(decodeURIComponent(requests(fetch, "/api/sync")[0].url.search)).toBe("?keys=planner-lists");
  });

  it("creates a named list with an icon, from the empty state or the + button", async () => {
    routeFetch();
    render(<ListsPage />);
    await screen.findByText("Start a list");
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Gift ideas" } });
    fireEvent.click(screen.getByRole("button", { name: "🎁" }));
    fireEvent.click(screen.getByText("Create"));
    expect(loadLists()[0]).toMatchObject({ name: "Gift ideas", icon: "🎁" });

    fireEvent.click(screen.getByText("+ New list"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByLabelText("List name")).toBeNull();
    fireEvent.click(screen.getByText("+ New list"));
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Books" } });
    fireEvent.submit(screen.getByLabelText("List name"));
    expect(loadLists().map((l) => l.name)).toEqual(["Gift ideas", "Books"]);
    expect(screen.getByRole("heading", { name: /Books/ })).toBeTruthy();
  });

  it("adds items, reading a price and link from the text, and totals the prices", async () => {
    routeFetch();
    const list = addList("Wishlist", "🎁");
    render(<ListsPage />);
    const box = await screen.findByLabelText("New item");
    fireEvent.change(box, { target: { value: "Headphones ₹2,999 amazon.in/x" } });
    fireEvent.click(screen.getByText("Add"));
    fireEvent.change(box, { target: { value: "Socks rs 300" } });
    fireEvent.submit(box);
    fireEvent.submit(box); // empty: nothing added

    expect(loadItems(list.id).map((i) => [i.text, i.price, i.link])).toEqual([
      ["Socks", 300, undefined],
      ["Headphones", 2999, "https://amazon.in/x"],
    ]);
    expect(within(row("Headphones")).getByText("🔗 amazon.in")).toBeTruthy();
    expect(screen.getByText("Total ₹3,299")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Wishlist/ })).getByText("2")).toBeTruthy();
  });

  it("ticks items off into a Done section and clears them", async () => {
    routeFetch();
    const list = addList("Remember");
    addItem(list.id, "Passport", { media: [photo] });
    addItem(list.id, "Keys");
    const fetch = routeFetch();
    render(<ListsPage />);
    fireEvent.click(await screen.findByLabelText("Mark “Passport” done"));
    expect(screen.queryByText("Passport")).toBeNull();
    fireEvent.click(screen.getByText(/Done \(1\)/));
    expect(screen.getByText("Passport")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Mark “Passport” not done"));
    fireEvent.click(screen.getByLabelText("Mark “Passport” done"));

    fireEvent.click(screen.getByText("Clear done"));
    expect(loadItems(list.id).map((i) => i.text)).toEqual(["Keys"]);
    await waitFor(() => expect(requests(fetch, "/api/media/photo-0001")[0]?.init?.method).toBe("DELETE"));
    expect(screen.queryByText(/Done \(/)).toBeNull();
  });

  it("edits an item's details, pins it, moves it and adds it to today's tasks", async () => {
    routeFetch();
    const wish = addList("Wishlist");
    const gifts = addList("Gifts");
    const item = addItem(wish.id, "Lamp");
    addItem(wish.id, "Older");
    render(<ListsPage />);
    await screen.findByText("Lamp");
    openRow("Lamp");

    const field = (label: string, value: string) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.blur(screen.getByLabelText(label));
    };
    field("Item text", "Desk lamp");
    field("Notes", "Warm white");
    field("Price", "₹1,200");
    field("Link", "javascript:alert(1)");
    expect(screen.getByText("That isn't a web link.")).toBeTruthy();
    field("Link", "ikea.com/lamp");
    expect(getItem(item.id)).toMatchObject({ text: "Desk lamp", note: "Warm white", price: 1200, link: "https://ikea.com/lamp" });
    expect(screen.getByText("Open ikea.com ↗").getAttribute("href")).toBe("https://ikea.com/lamp");
    field("Price", "free");
    field("Notes", "");
    expect(getItem(item.id)).not.toHaveProperty("price");
    expect(getItem(item.id)).not.toHaveProperty("note");

    fireEvent.click(screen.getByText("⭐ Pin"));
    expect(getItem(item.id)!.pinned).toBe(true);
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Desk lamp");
    fireEvent.click(screen.getByText("Unpin"));
    expect(getItem(item.id)).not.toHaveProperty("pinned");

    fireEvent.click(screen.getByText("+ Today's tasks"));
    expect(loadTodos(getTodayDate()).map((t) => t.text)).toEqual(["Desk lamp"]);
    expect(screen.getByRole("status").textContent).toBe("Added “Desk lamp” to today's tasks");

    fireEvent.change(screen.getByLabelText("Move to list"), { target: { value: gifts.id } });
    expect(getItem(item.id)!.listId).toBe(gifts.id);
    expect(screen.queryByText("Desk lamp")).toBeNull();

    openRow("Older");
    openRow("Older"); // closes again
    expect(screen.queryByLabelText("Item text")).toBeNull();
  });

  it("deletes an item at once, or after confirming when it has media", async () => {
    routeFetch();
    const list = addList("L");
    addItem(list.id, "Plain");
    addItem(list.id, "With photo", { media: [photo] });
    const fetch = routeFetch();
    render(<ListsPage />);
    await screen.findByText("Plain");
    openRow("Plain");
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.queryByText("Plain")).toBeNull();

    openRow("With photo");
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Keep"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Delete"));
    expect(loadItems(list.id)).toEqual([]);
    await waitFor(() => expect(requests(fetch, "/api/media/photo-0001")).toHaveLength(1));
  });

  it("deletes from the row without opening the item, confirming when it has media", async () => {
    routeFetch();
    const list = addList("L");
    addItem(list.id, "Plain");
    addItem(list.id, "With photo", { media: [photo] });
    addItem(list.id, "Finished");
    const fetch = routeFetch();
    render(<ListsPage />);
    fireEvent.click(await screen.findByLabelText("Delete “Plain”"));
    expect(screen.queryByText("Plain")).toBeNull();
    expect(screen.queryByLabelText("Item text")).toBeNull(); // the item never opened

    fireEvent.click(screen.getByLabelText("Delete “With photo”"));
    fireEvent.click(within(row("With photo")).getByText("Keep"));
    expect(screen.getByText("With photo")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Delete “With photo”"));
    fireEvent.click(screen.getByLabelText("Confirm delete “With photo”"));
    expect(loadItems(list.id).map((i) => i.text)).toEqual(["Finished"]);
    await waitFor(() => expect(requests(fetch, "/api/media/photo-0001")[0]?.init?.method).toBe("DELETE"));

    // Done items have it too.
    fireEvent.click(screen.getByLabelText("Mark “Finished” done"));
    fireEvent.click(screen.getByText(/Done \(1\)/));
    fireEvent.click(screen.getByLabelText("Delete “Finished”"));
    expect(loadItems(list.id)).toEqual([]);
  });

  it("uploads a photo as a new item named after the add box, or attaches one to an item", async () => {
    const fetch = routeFetch({ "/api/media/*": { ok: true } });
    const list = addList("Wishlist");
    const lamp = addItem(list.id, "Lamp");
    render(<ListsPage />);
    const box = await screen.findByLabelText("New item");
    fireEvent.change(box, { target: { value: "Sofa ₹40,000" } });
    fireEvent.click(screen.getByLabelText("Add a photo"));
    await act(async () => choosePhoto(jpeg()));
    await waitFor(() => expect(loadItems(list.id)).toHaveLength(2));
    const sofa = loadItems(list.id).find((i) => i.text === "Sofa")!;
    expect(sofa).toMatchObject({ price: 40000, media: [expect.objectContaining({ kind: "image", mime: "image/jpeg" })] });
    expect((box as HTMLInputElement).value).toBe("");
    const put = requests(fetch, `/api/media/${sofa.media![0].id}`)[0];
    expect(put.init?.method).toBe("PUT");
    // The new item opens with its photo.
    expect(screen.getByLabelText("Item text")).toHaveProperty("value", "Sofa");
    fireEvent.click(screen.getByLabelText("Open photo"));
    expect(screen.getByRole("dialog", { name: "Photo" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByLabelText("Open photo"));
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();

    // Without text, a photo becomes an item called "Photo".
    await act(async () => choosePhoto(jpeg()));
    await waitFor(() => expect(loadItems(list.id).map((i) => i.text)).toContain("Photo"));

    openRow("Lamp");
    fireEvent.click(screen.getByText("📷 Photo"));
    await act(async () => choosePhoto(jpeg()));
    await waitFor(() => expect(getItem(lamp.id)!.media).toHaveLength(1));
    expect(within(row("Lamp")).getByText("📷 1")).toBeTruthy();

    // Removing it deletes the upload too.
    const lampPhoto = getItem(lamp.id)!.media![0].id;
    fireEvent.click(within(row("Lamp")).getByLabelText("Remove photo"));
    expect(getItem(lamp.id)).not.toHaveProperty("media");
    await waitFor(() => expect(requests(fetch, `/api/media/${lampPhoto}`).map((r) => r.init?.method)).toEqual(["PUT", "DELETE"]));
  });

  it("shows why an upload failed and adds nothing", async () => {
    routeFetch({ "/api/media/*": () => jsonResponse({}, { status: 500 }) });
    const list = addList("Wishlist");
    render(<ListsPage />);
    await screen.findByLabelText("New item");
    await act(async () => choosePhoto(jpeg()));
    expect(await screen.findByText("Upload failed (500).")).toBeTruthy();
    expect(loadItems(list.id)).toEqual([]);
    await act(async () => choosePhoto(new File(["x"], "doc.pdf", { type: "application/pdf" })));
    expect(await screen.findByText(/isn't supported/)).toBeTruthy();
    fireEvent.change(screen.getByTestId("photo-input"), { target: { files: [] } });
    expect(loadItems(list.id)).toEqual([]);
  });

  it("records a voice note as a new item, and onto an existing one", async () => {
    const fetch = routeFetch({ "/api/media/*": { ok: true } });
    const { getUserMedia, track } = stubRecorder();
    const list = addList("Remember");
    const idea = addItem(list.id, "Idea");
    render(<ListsPage />);
    await screen.findByLabelText("New item");

    await act(async () => fireEvent.click(screen.getByLabelText("Record a voice note")));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByLabelText("Stop recording").textContent).toContain("0:00");
    await act(async () => fireEvent.click(screen.getByLabelText("Stop recording")));
    await waitFor(() => expect(loadItems(list.id).map((i) => i.text)).toContain("Voice note"));
    expect(track.stop).toHaveBeenCalled();
    const note = loadItems(list.id).find((i) => i.text === "Voice note")!;
    expect(note.media![0]).toMatchObject({ kind: "voice", mime: "audio/webm", seconds: 1 });
    expect(requests(fetch, `/api/media/${note.media![0].id}`)[0].init?.headers).toEqual({ "Content-Type": "audio/webm" });
    expect(screen.getByLabelText("Voice note").getAttribute("src")).toBe(`/api/media/${note.media![0].id}`);

    openRow("Idea");
    const inIdea = within(row("Idea"));
    await act(async () => fireEvent.click(inIdea.getByLabelText("Record a voice note")));
    await act(async () => fireEvent.click(inIdea.getByLabelText("Stop recording")));
    await waitFor(() => expect(getItem(idea.id)!.media).toHaveLength(1));
    expect(inIdea.getByText("🎙 1")).toBeTruthy();
  });

  it("explains when the microphone isn't available", async () => {
    routeFetch();
    addList("Remember");
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    render(<ListsPage />);
    await act(async () => fireEvent.click(await screen.findByLabelText("Record a voice note")));
    expect(screen.getByText("This browser can't record audio.")).toBeTruthy();

    const { getUserMedia } = stubRecorder();
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    await act(async () => fireEvent.click(screen.getByLabelText("Record a voice note")));
    expect(screen.getByText(/Microphone access was blocked/)).toBeTruthy();
  });

  it("caps media per item", async () => {
    routeFetch();
    const list = addList("L");
    addItem(list.id, "Full", { media: [photo, voice, ...[2, 3, 4, 5].map((n) => ({ ...photo, id: `photo-000${n}` }))] });
    render(<ListsPage />);
    await screen.findByText("Full");
    openRow("Full");
    expect(screen.getByText("📷 Photo")).toHaveProperty("disabled", true);
    expect(screen.getByText(/Up to 6 photos/)).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy(); // the voice note's length
    fireEvent.click(screen.getByLabelText("Remove voice note"));
    expect(getItem(loadItems(list.id)[0].id)!.media).toHaveLength(5);
  });

  it("searches every list and switches lists, remembering the last one", async () => {
    routeFetch();
    const a = addList("Books", "📚");
    const b = addList("Wishlist");
    addItem(a.id, "Blue Book");
    addItem(b.id, "Blue scarf");
    addItem(b.id, "Hat");
    const { unmount } = render(<ListsPage />);
    expect(await screen.findByText("Blue Book")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search all lists"), { target: { value: "blue" } });
    expect(screen.getByText("2 found in all lists")).toBeTruthy();
    expect(within(row("Blue scarf")).getByText("Wishlist")).toBeTruthy();
    expect(within(row("Blue Book")).getByText("📚 Books")).toBeTruthy();
    expect(screen.queryByLabelText("New item")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search all lists"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Wishlist/ }));
    expect((screen.getByLabelText("Search all lists") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Hat")).toBeTruthy();
    expect(screen.queryByText("Blue Book")).toBeNull();
    unmount();

    render(<ListsPage />);
    expect(await screen.findByText("Hat")).toBeTruthy();
  });

  it("renames, re-icons and deletes a list with its media", async () => {
    routeFetch();
    const list = addList("Wishlist", "🎁");
    addList("Other");
    addItem(list.id, "Bag", { media: [photo] });
    const fetch = routeFetch();
    render(<ListsPage />);
    fireEvent.click(await screen.findByLabelText("Edit list"));
    fireEvent.change(screen.getByLabelText("Rename list"), { target: { value: "Wants" } });
    fireEvent.click(screen.getByRole("button", { name: "🛒" }));
    expect(loadLists()[0].icon).toBe("🛒");
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("heading", { name: /Wants/ })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Edit list"));
    fireEvent.click(screen.getByText("Delete list"));
    fireEvent.click(screen.getByText("Keep"));
    fireEvent.click(screen.getByText("Delete list"));
    fireEvent.click(screen.getByText("Delete"));
    expect(loadLists().map((l) => l.name)).toEqual(["Other"]);
    expect(screen.getByRole("heading", { name: /Other/ })).toBeTruthy();
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
    await waitFor(() => expect(requests(fetch, "/api/media/photo-0001")).toHaveLength(1));
  });

  it("takes in lists that arrive from another device", async () => {
    const server = {
      lists: [{ value: { id: "s", name: "From phone", createdAt: 1 }, updatedAt: 1 }],
      items: [{ value: { id: "i", listId: "s", text: "Milk", done: false, createdAt: 1 }, updatedAt: 1 }],
    };
    routeFetch({
      "/api/sync": (_u, init) => (init?.method === "POST" ? { etag: '"e"' } : { docs: { "planner-lists": { etag: '"s1"', data: server } } }),
    });
    render(<ListsPage />);
    expect(await screen.findByText("Milk")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /From phone/ })).toBeTruthy();
  });
});

describe("links from search", () => {
  it("opens the named list and item, in the Done section if it's done", async () => {
    addList("Other");
    const list = addList("Gifts");
    const item = addItem(list.id, "Headphones");
    window.history.replaceState(null, "", `/todos/lists?list=${list.id}&item=${item.id}`);
    const first = render(<ListsPage />);
    expect(await screen.findByRole("heading", { name: /Gifts/ })).toBeTruthy();
    expect(screen.getAllByText("Headphones").length).toBeGreaterThan(0);
    first.unmount();

    const finished = addItem(list.id, "Wrapped", { done: true });
    window.history.replaceState(null, "", `/todos/lists?list=${list.id}&item=${finished.id}`);
    render(<ListsPage />);
    expect(await screen.findByText("Wrapped")).toBeTruthy();
    window.history.replaceState(null, "", "/");
  });
});
