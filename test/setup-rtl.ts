// Loaded for every test file (see vitest.config.ts setupFiles). Registers
// React Testing Library's DOM cleanup after each test — needed explicitly
// because this project doesn't enable Vitest's `globals` mode, which is
// what RTL's own auto-registration otherwise relies on detecting. Guarded
// on `document` existing so plain "node" environment tests (the large
// majority of this suite) are unaffected.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  if (typeof document !== "undefined") {
    cleanup();
  }
});
