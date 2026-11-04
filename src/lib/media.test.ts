// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MAX_MEDIA_BYTES, baseMime, deleteMedia, mediaUrl, shrinkImage, uploadMedia } from "./media";
import { jsonResponse } from "@/test/fixtures";

const blob = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });

describe("uploadMedia", () => {
  it("PUTs the file under a new id and returns its reference", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const ref = await uploadMedia(blob(10, "audio/webm;codecs=opus"), 7);
    expect(ref).toMatchObject({ kind: "voice", mime: "audio/webm", size: 10, seconds: 7 });
    expect(ref.id).toMatch(/^[a-z0-9-]{36}$/);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(mediaUrl(ref.id));
    expect(init).toMatchObject({ method: "PUT", headers: { "Content-Type": "audio/webm" } });

    const img = await uploadMedia(blob(5, "image/png"));
    expect(img).toMatchObject({ kind: "image", mime: "image/png" });
    expect("seconds" in img).toBe(false);
  });

  it("refuses unsupported or oversized files before uploading", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(uploadMedia(blob(5, "application/pdf"))).rejects.toThrow(/isn't supported/);
    await expect(uploadMedia(blob(MAX_MEDIA_BYTES + 1, "image/jpeg"))).rejects.toThrow(/too big \(max 1.5 MB\)/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("explains failed uploads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(jsonResponse({}, { status: 500 })));
    await expect(uploadMedia(blob(5, "image/jpeg"))).rejects.toThrow(/connection/);
    await expect(uploadMedia(blob(5, "image/jpeg"))).rejects.toThrow("Upload failed (500).");
  });
});

describe("deleteMedia", () => {
  it("deletes each file and only logs failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 500 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    await deleteMedia(["aaaaaaaa", "bbbbbbbb", "cccccccc"]);
    expect(fetch.mock.calls.map(([u, i]) => [u, i.method])).toEqual([
      ["/api/media/aaaaaaaa", "DELETE"],
      ["/api/media/bbbbbbbb", "DELETE"],
      ["/api/media/cccccccc", "DELETE"],
    ]);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe("shrinkImage", () => {
  const file = blob(5000, "image/png");

  function stubCanvas(out: Blob | null, ctx: unknown = { drawImage: vi.fn() }) {
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob | null) => void) => cb(out) };
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => (tag === "canvas" ? (canvas as never) : create(tag)));
    return canvas;
  }

  it("keeps the original where the browser can't decode images", async () => {
    expect(await shrinkImage(file)).toBe(file);
  });

  it("scales the longest side down to 1600px as JPEG", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close })));
    const small = blob(100, "image/jpeg");
    const canvas = stubCanvas(small);
    expect(await shrinkImage(file)).toBe(small);
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    expect(close).toHaveBeenCalled();
  });

  it("keeps the original when shrinking doesn't help or fails", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 50 })));
    stubCanvas(blob(9000, "image/jpeg"));
    expect(await shrinkImage(file)).toBe(file); // bigger than before
    vi.restoreAllMocks();
    stubCanvas(null);
    expect(await shrinkImage(file)).toBe(file);
    vi.restoreAllMocks();
    stubCanvas(null, null); // no 2D context
    expect(await shrinkImage(file)).toBe(file);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => Promise.reject(new Error("bad image"))));
    expect(await shrinkImage(file)).toBe(file);
  });

  it("drops codec parameters from types", () => {
    expect(baseMime(" Audio/WebM; codecs=opus")).toBe("audio/webm");
  });
});
