import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DB_PATH = path.join(process.cwd(), "test", ".db", "vitest.db");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./test/global-setup.ts"],
    env: { DB_PATH: TEST_DB_PATH },
    // Every test file points at the same on-disk DB, and each file's
    // beforeEach clears tables for isolation — running files in parallel
    // would race those clears against each other.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
});
