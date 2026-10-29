import { defineConfig } from "vitest/config";
import path from "path";
// Tests run in Node by default; browser-side files opt in with `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: { setupFiles: ["./src/test/setup.ts"], restoreMocks: true, unstubGlobals: true, unstubEnvs: true },
});
