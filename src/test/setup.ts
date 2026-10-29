import { afterEach } from "vitest";

// Unmount React trees between tests (Testing Library only auto-cleans with vitest globals on).
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  localStorage.clear();
});
