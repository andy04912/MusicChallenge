import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { clearRequestCache } from "./lib/api.js";
afterEach(() => {
  clearRequestCache();
  cleanup();
  vi.restoreAllMocks();
});
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
HTMLMediaElement.prototype.load = () => {};
HTMLMediaElement.prototype.pause = () => {};
HTMLMediaElement.prototype.play = async () => {};
