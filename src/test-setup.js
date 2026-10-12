import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
afterEach(() => {
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
