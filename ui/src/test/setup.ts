// ui/src/test/setup.ts — vitest setup: testing-library matchers + DOM cleanup.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
