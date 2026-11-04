import { afterEach, vi } from "vitest";

// jsdom has no Blob.arrayBuffer(), which every browser does.
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// Unmount React trees between tests (Testing Library only auto-cleans with vitest globals on).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  // Let in-flight sync work (fetch → json → localStorage) finish, so it can't write into the
  // next test's storage.
  vi.useRealTimers();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  localStorage.clear();
});
