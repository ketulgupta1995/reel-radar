import { afterEach, vi } from "vitest";

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
