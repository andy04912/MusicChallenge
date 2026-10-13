import { beforeEach, expect, test, vi } from "vitest";
import { readPlayerName, savePlayerName } from "./player-name.js";

beforeEach(() => localStorage.clear());

test("remembers edits before submission and prefers them over a fresh server guest", () => {
  expect(readPlayerName("訪客 123")).toBe("訪客 123");
  savePlayerName("唱片女孩");
  expect(readPlayerName("訪客 456")).toBe("唱片女孩");
  savePlayerName("唱片女");
  expect(readPlayerName()).toBe("唱片女");
});
test("preserves spaces while typing, trims restored names, and caps names at twenty characters", () => {
  expect(savePlayerName("  Andy ")).toBe("  Andy ");
  expect(readPlayerName()).toBe("Andy");
  expect(savePlayerName("x".repeat(30))).toHaveLength(20);
  expect(readPlayerName()).toHaveLength(20);
  savePlayerName("   ");
  expect(readPlayerName("訪客")).toBe("訪客");
});
test("disabled storage never breaks name entry or fallback", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(savePlayerName("Andy")).toBe("Andy");
  expect(readPlayerName("訪客")).toBe("訪客");
});
