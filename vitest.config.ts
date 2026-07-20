import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "test/shims/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "lib/**/*.test.ts", "components/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup-rtl.ts"],
  },
});
