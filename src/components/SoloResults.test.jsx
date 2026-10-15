import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import SoloResults from "./SoloResults.jsx";

const run = {
  id: "results-test",
  mode: "endless",
  score: 5000,
  correct: 5,
  played: 13,
  history: Array.from({ length: 13 }, (_, i) => ({
    round: i + 1,
    points: 1000,
    song: {
      id: i + 1,
      title: `歌曲 ${i + 1}`,
      artist: "測試歌手",
      artwork: "/test.jpg",
      url: "https://music.apple.com/tw/song/1",
    },
  })),
};
let height, resize;
const disconnect = vi.fn();
beforeEach(() => {
  height = 320;
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function () {
      return this.classList.contains("solo-history") ? height : 0;
    },
  );
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "64px" }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

test("uses available height, retains the current song after resizing and reaches the last page", () => {
  const restart = vi.fn();
  const { unmount } = render(<SoloResults run={run} onRestart={restart} />);
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(screen.getByText("1–5 / 13 首")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "下一頁歌曲" }));
  expect(screen.getByText("歌曲 6")).toBeVisible();
  act(() => {
    height = 256;
    resize();
  });
  expect(screen.getAllByRole("article")).toHaveLength(4);
  expect(screen.getByText("歌曲 6")).toBeVisible();
  expect(screen.getByText("5–8 / 13 首")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "下一頁歌曲" }));
  fireEvent.click(screen.getByRole("button", { name: "下一頁歌曲" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("歌曲 13")).toBeVisible();
  expect(screen.getByRole("button", { name: "下一頁歌曲" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "再挑戰一次" }));
  expect(restart).toHaveBeenCalledOnce();
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

test("handles a short viewport and empty results without invalid pages", () => {
  height = 50;
  const { rerender } = render(<SoloResults run={run} onRestart={() => {}} />);
  expect(screen.getAllByRole("article")).toHaveLength(1);
  rerender(
    <SoloResults
      run={{ ...run, history: [], played: 0, correct: 0, score: 0 }}
      onRestart={() => {}}
    />,
  );
  expect(screen.getByText("這次還沒有完成的歌曲。")).toBeVisible();
  expect(screen.getByRole("button", { name: "上一頁歌曲" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下一頁歌曲" })).toBeDisabled();
});
