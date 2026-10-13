import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import LeaderboardPage from "./LeaderboardPage.jsx";
import { request } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ request: vi.fn() }));
let height, resize;
beforeEach(() => {
  height = 470;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function () {
      return this.classList.contains("board-list") ? height : 0;
    },
  );
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "66px" }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  request.mockReset();
  request.mockImplementation(async (url) => {
    const query = new URL(url, "https://music.test").searchParams;
    const count = Number(query.get("limit")),
      offset = Number(query.get("offset"));
    return {
      hasMore: true,
      entries: Array.from({ length: count }, (_, i) => ({
        rank: offset + i + 1,
        nickname: `玩家 ${offset + i + 1}`,
        score: 1000,
        correct: 3,
        played: 5,
        region: "kr",
      })),
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

test("fills available rows, pages by capacity and resets pagination after resize", async () => {
  render(<LeaderboardPage />);
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(7));
  fireEvent.click(screen.getByRole("button", { name: "排行榜下一頁" }));
  await screen.findByText("玩家 8");
  expect(request.mock.lastCall[0]).toContain("offset=7&limit=7");
  act(() => {
    height = 270;
    resize();
  });
  await screen.findByText("玩家 1");
  expect(screen.getAllByRole("article")).toHaveLength(4);
  expect(request.mock.lastCall[0]).toContain("offset=0&limit=4");
  expect(screen.getByRole("button", { name: "排行榜上一頁" })).toBeDisabled();
});

test("caps requests at the API limit and preserves the compact endless copy", async () => {
  height = 2000;
  render(<LeaderboardPage />);
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(20));
  fireEvent.click(screen.getByRole("button", { name: "無限挑戰" }));
  await waitFor(() =>
    expect(screen.getAllByText("猜中 3 首")).toHaveLength(20),
  );
  expect(screen.queryByText("K-POP · 猜中 3 / 5 首")).not.toBeInTheDocument();
});
