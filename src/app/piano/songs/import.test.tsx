// @vitest-environment jsdom
import { openSettings } from "@/test/stage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { installFakeAudio } from "@/test/audio";
import { fakeMidi, uninstallMidi } from "@/test/midi";
import { endOfTrack, midiFile, note, on, off, tempo, timeSig, track, trackName } from "@/test/midiFile";
import { routeFetch } from "@/test/pages";
import { MAX_MIDI_BYTES, MAX_NOTES } from "@/lib/pianoMidiFile";
import { encodeSong } from "@/lib/pianoSongImport";
import { Song } from "@/lib/pianoSongs";
import PianoLayout from "../layout";
import SongsPage from "./page";
import SongPage from "./[id]/page";

let songId = "x";
vi.mock("next/navigation", () => ({ usePathname: () => "/piano/songs", useParams: () => ({ id: songId }) }));

const open = async (ui = <SongsPage />) => {
  render(<PianoLayout>{ui}</PianoLayout>);
  await act(async () => {});
};
const input = () => screen.getByLabelText("MIDI file") as HTMLInputElement;
const upload = async (bytes: Uint8Array, name = "tune.mid") => {
  await act(async () => {
    fireEvent.change(input(), { target: { files: [new File([bytes as BlobPart], name, { type: "audio/midi" })] } });
  });
};
const expectAlert = (re: RegExp) => waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(re));
const settings = () => JSON.parse(localStorage.getItem("reel-radar-piano-settings") || "{}");
const docKeys = () => Object.keys(localStorage).filter((k) => /^reel-radar-piano-song-/.test(k));

// A one-track tune: C major scale up (right-hand range) then down into the left hand's range.
const oneTrack = () =>
  midiFile([track(trackName(0, "Scale Tune"), tempo(0, 96), timeSig(0, 3, 2), ...[72, 74, 76, 77].flatMap((p) => note(p)), ...[48, 50, 52, 53, 55].flatMap((p) => note(p)), endOfTrack())]);
const twoTracks = () => midiFile([track(...[72, 74, 76].flatMap((p) => note(p)), endOfTrack()), track(...[48, 52].flatMap((p) => note(p, 2)), endOfTrack())]);

beforeEach(() => {
  installFakeAudio();
  localStorage.clear();
  songId = "x";
  routeFetch();
  const m = fakeMidi();
  m.install();
  m.plug();
});
afterEach(() => {
  uninstallMidi();
  vi.restoreAllMocks();
});

describe("importing a MIDI file", () => {
  it("previews the file, moves the split point, saves it, lists it, and plays it", async () => {
    await open();
    await upload(oneTrack());
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Scale Tune");
    expect(screen.getByTestId("import-info").textContent).toBe("96 BPM · 3 beats a bar · 3 bars");
    expect(screen.getByTestId("import-counts").textContent).toContain("Right hand 4 notes · Left hand 5 notes");
    fireEvent.change(screen.getByLabelText("Split point"), { target: { value: "50" } });
    expect(screen.getByText(/Split the hands at D3/)).toBeTruthy();
    expect(screen.getByTestId("import-counts").textContent).toContain("Right hand 8 notes · Left hand 1 notes");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My scale" } });
    fireEvent.click(screen.getByRole("button", { name: "Save song" }));

    expect(screen.getByText(/Saved/).textContent).toContain("My scale");
    expect(screen.queryByLabelText("Split point")).toBeNull();
    const yours = screen.getByRole("heading", { name: "Your songs" }).parentElement!;
    expect(within(yours).getByText("My scale")).toBeTruthy();
    expect(within(yours).getByLabelText("Imported")).toBeTruthy();
    const [id] = Object.keys(settings().importedSongs);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(settings().importedSongs[id]).toMatchObject({ title: "My scale" });
    expect(docKeys()).toEqual([`reel-radar-piano-song-${id}`]);
    expect(JSON.parse(localStorage.getItem(`reel-radar-piano-song-${id}`)!)).toMatchObject({ split: 50, bpm: 96, beatsPerBar: 3 });
    expect(within(yours).getByRole("link").getAttribute("href")).toBe(`/piano/songs/${id}`);
  });

  it("opens an imported song in the player with its suggested fingering marked", async () => {
    await open();
    await upload(oneTrack());
    fireEvent.click(screen.getByRole("button", { name: "Save song" }));
    const id = Object.keys(settings().importedSongs)[0];
    songId = id;
    document.body.innerHTML = "";
    await open(<SongPage />);
    expect(await screen.findByRole("heading", { name: "Scale Tune" })).toBeTruthy();
    openSettings();
    expect(screen.getByText(/^Imported · 96 BPM · 3 beats a bar/)).toBeTruthy();
    expect(screen.getByTestId("suggested").textContent).toContain("fingering suggested");
    expect(screen.getAllByTestId("note").length).toBeGreaterThan(0);
    // right hand starts on the scale's lowest right-hand note with the thumb
    expect(screen.getAllByTestId("note")[0].textContent).toContain("1");
  });

  it("takes the hands from two tracks and shows no split slider", async () => {
    await open();
    await upload(twoTracks(), "two_hands.mid");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("two hands");
    expect(screen.getByTestId("import-counts").textContent).toContain("Right hand 3 notes · Left hand 2 notes (hands taken from the file's tracks)");
    expect(screen.queryByLabelText("Split point")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save song" }));
    const id = Object.keys(settings().importedSongs)[0];
    expect(JSON.parse(localStorage.getItem(`reel-radar-piano-song-${id}`)!).split).toBeUndefined();
  });

  it("can be cancelled", async () => {
    await open();
    await upload(oneTrack());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save song" })).toBeNull();
    expect(docKeys()).toEqual([]);
  });

  it("explains a bad, oversized, unsupported or empty file, and saves nothing", async () => {
    await open();
    await upload(new TextEncoder().encode("definitely not a midi file at all"), "x.mid");
    await expectAlert(/isn't a readable MIDI file/);
    await upload(midiFile([track(...note(60), endOfTrack())], { format: 2 }));
    await expectAlert(/format 2/);
    await upload(midiFile([track(on(0, 36, 100, 9), off(10, 36, 9), endOfTrack())]));
    await expectAlert(/No notes found/);
    // over the size cap: refused from the file's size, without reading it
    const big = new File([new Uint8Array(MAX_MIDI_BYTES + 1)], "big.mid");
    const read = vi.spyOn(big, "arrayBuffer");
    await act(async () => {
      fireEvent.change(input(), { target: { files: [big] } });
    });
    await expectAlert(/too big/);
    expect(read).not.toHaveBeenCalled();
    // too many notes
    const many = Array.from({ length: MAX_NOTES + 1 }, (_, i) => [on(i ? 1 : 0, 30 + (i % 60)), off(0, 30 + (i % 60))]).flat();
    await upload(midiFile([track(...many, endOfTrack())]));
    await expectAlert(/too many/);
    expect(screen.queryByRole("button", { name: "Save song" })).toBeNull();
    expect(docKeys()).toEqual([]);
    expect(settings().importedSongs).toBeUndefined();
    // a good file after a bad one clears the message
    await upload(oneTrack());
    await screen.findByRole("button", { name: "Save song" });
    expect(screen.queryByRole("alert")).toBeNull();
    // choosing nothing is harmless
    await act(async () => {
      fireEvent.change(input(), { target: { files: [] } });
    });
    expect(screen.queryByRole("button", { name: "Save song" })).toBeNull();
  });

  it("says so when the file cannot be read at all, and ignores a file that finishes after a newer pick", async () => {
    await open();
    const broken = new File([new Uint8Array(20)], "b.mid");
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(new Error("gone"));
    await act(async () => {
      fireEvent.change(input(), { target: { files: [broken] } });
    });
    await expectAlert(/couldn't be read/);
    let finish: (b: ArrayBuffer) => void = () => {};
    const slow = new File([new Uint8Array(20)], "slow.mid");
    vi.spyOn(slow, "arrayBuffer").mockReturnValue(new Promise((r) => (finish = r)));
    act(() => void fireEvent.change(input(), { target: { files: [slow] } }));
    await act(async () => {
      fireEvent.change(input(), { target: { files: [] } }); // the newer pick: nothing
    });
    await act(async () => finish(oneTrack().buffer as ArrayBuffer));
    expect(screen.queryByRole("button", { name: "Save song" })).toBeNull();
    const slowBad = new File([new Uint8Array(20)], "slow2.mid");
    let fail: (e: Error) => void = () => {};
    vi.spyOn(slowBad, "arrayBuffer").mockReturnValue(new Promise((_, r) => (fail = r)));
    act(() => void fireEvent.change(input(), { target: { files: [slowBad] } }));
    await act(async () => {
      fireEvent.change(input(), { target: { files: [] } });
    });
    await act(async () => fail(new Error("late")));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when it cannot save", async () => {
    await open();
    await upload(oneTrack());
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(screen.getByRole("button", { name: "Save song" }));
    spy.mockRestore();
    await expectAlert(/no room/);
    expect(docKeys()).toEqual([]);
  });
});

describe("deleting an imported song", () => {
  const importOne = async (title = "Scale Tune") => {
    await open();
    await upload(oneTrack());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: title } });
    fireEvent.click(screen.getByRole("button", { name: "Save song" }));
    return Object.keys(settings().importedSongs)[0];
  };

  it("asks first, can be cancelled, then removes the song everywhere", async () => {
    const id = await importOne();
    fireEvent.click(screen.getByRole("button", { name: "Delete Scale Tune" }));
    expect(screen.getByText(/Delete .Scale Tune. from every device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByText("Scale Tune")).toBeTruthy();
    expect(settings().importedSongs[id].removed).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete Scale Tune" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(screen.queryByText("Scale Tune")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your songs" })).toBeNull();
    expect(settings().importedSongs[id].removed).toBe(true);
    expect(JSON.parse(localStorage.getItem(`reel-radar-piano-song-${id}`)!)).toEqual({ removed: true });
    // the built-in songs are untouched, and a removed id no longer opens
    expect(screen.getByText("Für Elise (opening)")).toBeTruthy();
    songId = id;
    document.body.innerHTML = "";
    await open(<SongPage />);
    expect(await screen.findByText("That song isn't in the list.")).toBeTruthy();
  });
});

describe("songs from another device", () => {
  const song = (id: string, title: string): Song => ({
    id,
    title,
    bpm: 90,
    beatsPerBar: 4,
    level: 0,
    imported: true,
    notes: [{ start: 0, dur: 1, pitch: 64, hand: "R", finger: 1, suggested: true }, { start: 1, dur: 1, pitch: 48, hand: "L", finger: 5, suggested: true }],
  });
  const A = "0123456789ab";
  const B = "ba9876543210";
  const server = (docs: Record<string, unknown>) =>
    routeFetch({
      "/api/sync": (url: URL, init?: RequestInit) => {
        if (init?.method === "POST") return { etag: '"e"' };
        const keys = decodeURIComponent(url.searchParams.get("keys") ?? "").split(",").map((k) => k.split(":")[0]);
        return { docs: Object.fromEntries(keys.map((k) => [k, k in docs ? { etag: '"s"', data: docs[k] } : null])) };
      },
    });

  it("lists a song the settings name, after fetching its doc, and removes a deleted one", async () => {
    const f = server({
      "piano-settings": { unlocks: {}, slowSteps: {}, slowAt: {}, months: [], songs: {}, updatedAt: 5, importedSongs: { [A]: { title: "Laptop tune", at: 5 }, [B]: { title: "Old one", at: 4, removed: true } } },
      [`piano-song-${A}`]: encodeSong(song(A, "Laptop tune")),
    });
    await open();
    expect(await screen.findByText("Laptop tune")).toBeTruthy();
    expect(screen.queryByText("Old one")).toBeNull();
    const asked = f.mock.calls.map(([u]) => decodeURIComponent(String(u))).filter((u) => u.includes(`piano-song-`));
    expect(asked).toEqual([`/api/sync?keys=piano-song-${A}`]); // the removed song's doc is never fetched
    expect(within(screen.getByRole("heading", { name: "Your songs" }).parentElement!).getByLabelText("Imported")).toBeTruthy();
  });

  it("opens a linked song this device hasn't pulled yet", async () => {
    server({ [`piano-song-${A}`]: encodeSong(song(A, "Linked tune")) });
    songId = A;
    await open(<SongPage />);
    expect(await screen.findByRole("heading", { name: "Linked tune" })).toBeTruthy();
    openSettings();
    expect(screen.getByText(/^Imported · 90 BPM/)).toBeTruthy();
  });

  it("says a song is missing when neither storage nor the server has it, or its doc is invalid", async () => {
    server({ [`piano-song-${A}`]: { v: 1, id: A, title: "Bad", bpm: 1, beatsPerBar: 4, notes: [] } });
    songId = A;
    await open(<SongPage />);
    await waitFor(() => expect(screen.getByText("That song isn't in the list.")).toBeTruthy());
  });

  it("shows Loading… before it has looked, never a not-found flash", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    routeFetch({ "/api/sync": async () => (await gate, { docs: {} }) });
    songId = A;
    render(<PianoLayout><SongPage /></PianoLayout>);
    expect(screen.getByText("Loading…")).toBeTruthy();
    release();
    await waitFor(() => expect(screen.getByText("That song isn't in the list.")).toBeTruthy());
  });
});
