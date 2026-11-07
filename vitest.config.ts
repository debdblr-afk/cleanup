import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests only; e2e/ belongs to Playwright.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { include: ["lib/**/*.test.ts"] },
});
