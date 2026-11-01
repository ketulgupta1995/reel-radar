import { defineConfig } from "vitest/config";
import path from "path";
// Tests run in Node by default; browser-side files opt in with `// @vitest-environment jsdom`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: {
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    // `npm run coverage`: text summary in the terminal, HTML report in coverage/.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.*", "src/test/**"],
      reporter: ["text", "html", "json-summary"],
      // Fails `npm run coverage` if coverage drops below this (it was ~98.8% lines when set).
      thresholds: { lines: 97, statements: 97, functions: 95, branches: 90 },
    },
  },
});
