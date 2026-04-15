import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

Object.assign(globalThis, {
  ResizeObserver: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
});

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});
