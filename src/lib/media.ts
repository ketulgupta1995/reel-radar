// Photos and voice notes attached to list items (lib/lists.ts). Each one is uploaded once to
// /api/media/<id>, stored as its own doc, and served back with a long private cache, so a device
// downloads it at most once. Shared by the browser and the route.

export type MediaKind = "image" | "voice";
export type MediaRef = { id: string; kind: MediaKind; mime: string; size: number; seconds?: number };

export const MEDIA_ID = /^[a-z0-9-]{8,64}$/;
export const MAX_MEDIA_BYTES = 1_500_000; // per file, after shrinking
export const MAX_VOICE_SECONDS = 120;
export const MAX_ITEM_MEDIA = 6;

// What the route accepts and serves back. Codec parameters ("audio/webm;codecs=opus") are dropped.
export const MEDIA_TYPES: Record<string, MediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "audio/webm": "voice",
  "audio/ogg": "voice",
  "audio/mp4": "voice",
  "audio/mpeg": "voice",
};

export const baseMime = (type: string) => type.split(";")[0].trim().toLowerCase();

export const mediaUrl = (id: string) => `/api/media/${id}`;

export const newMediaId = () => crypto.randomUUID().toLowerCase();

const IMAGE_EDGE = 1600; // px, longest side
const IMAGE_QUALITY = 0.8;

// Shrink a photo to at most IMAGE_EDGE on its longest side, as JPEG. Browsers without
// createImageBitmap, or a file that can't be decoded, keep the original.
export async function shrinkImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

// Upload a photo or recording. Resolves to its reference, or throws with a message to show.
export async function uploadMedia(blob: Blob, seconds?: number): Promise<MediaRef> {
  const mime = baseMime(blob.type);
  const kind = MEDIA_TYPES[mime];
  if (!kind) throw new Error("That file type isn't supported. Use a photo (JPEG, PNG, WebP, GIF) or a voice note.");
  if (blob.size > MAX_MEDIA_BYTES) throw new Error(`That file is too big (max ${Math.round(MAX_MEDIA_BYTES / 1_000_000 * 10) / 10} MB).`);
  const id = newMediaId();
  let res: Response;
  try {
    res = await fetch(mediaUrl(id), { method: "PUT", headers: { "Content-Type": mime }, body: blob });
  } catch {
    throw new Error("Couldn't upload. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  return { id, kind, mime, size: blob.size, ...(seconds ? { seconds } : {}) };
}

// Delete uploaded media. A failure only leaves an unused file behind, so it's logged, not thrown.
export async function deleteMedia(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id) =>
      fetch(mediaUrl(id), { method: "DELETE" })
        .then((res) => {
          if (!res.ok) console.error(`[Media] Deleting ${id} failed (${res.status})`);
        })
        .catch((err) => console.error(`[Media] Deleting ${id} failed`, err))
    )
  );
}
