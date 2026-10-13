import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import AppShell from "./AppShell.jsx";
import GamePage from "../pages/GamePage.jsx";
import DuelPage from "../pages/DuelPage.jsx";
import PartyPage from "../pages/PartyPage.jsx";
import LeaderboardPage from "../pages/LeaderboardPage.jsx";

let fetch;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  fetch = vi.fn(
    async (path) =>
      new Response(
        JSON.stringify(
          path === "/api/catalog"
            ? [
                {
                  id: 1,
                  title: "Test song",
                  artist: "Singer",
                  region: "kr",
                  category: "girl",
                  year: "2024",
                },
              ]
            : path === "/api/player"
              ? { id: "player", nickname: "Tester" }
              : path.startsWith("/api/leaderboard?")
                ? { entries: [], hasMore: false }
                : { partyJoinOrigins: [] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function app() {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<GamePage />} />
          <Route path="duel" element={<DuelPage />} />
          <Route path="party" element={<PartyPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test("clicking the current navigation tab preserves setup instead of remounting it", async () => {
  app();
  await screen.findByDisplayValue("Tester");
  fireEvent.click(screen.getByRole("button", { name: "下一步：選擇歌曲" }));
  fireEvent.click(screen.getByRole("link", { name: "猜歌", exact: true }));
  expect(screen.getByRole("button", { name: "開始猜歌" })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("returning between setup pages reuses catalog/player and shows content immediately", async () => {
  app();
  await screen.findByDisplayValue("Tester");
  fireEvent.click(screen.getByRole("link", { name: "好友對戰", exact: true }));
  expect(screen.getByRole("textbox", { name: "你的暱稱" })).toBeInTheDocument();
  expect(screen.queryByText("連接房間中…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "派對", exact: true }));
  expect(screen.getByRole("textbox", { name: "主控暱稱" })).toBeInTheDocument();
  expect(screen.queryByText("正在連接派對…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "排行榜", exact: true }));
  await screen.findByText("榜上還有空位，等你來挑戰。");
  fireEvent.click(screen.getByRole("link", { name: "猜歌", exact: true }));
  expect(
    screen.getByRole("textbox", { name: "排行榜暱稱" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("正在準備題庫…")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "排行榜", exact: true }));
  expect(screen.getByText("榜上還有空位，等你來挑戰。")).toBeInTheDocument();
  expect(
    fetch.mock.calls.filter(([path]) => path === "/api/catalog"),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([path]) => path === "/api/player"),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([path]) => path.startsWith("/api/leaderboard?")),
  ).toHaveLength(1);
});

test("a stalled initial load exits the spinner with an actionable retry", async () => {
  vi.useFakeTimers();
  fetch.mockImplementation(
    (_path, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  app();
  expect(screen.getByText("正在準備題庫…")).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  expect(screen.queryByText("正在準備題庫…")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("連線逾時");
  expect(screen.getByRole("button", { name: "重新載入題庫" })).toBeEnabled();
  fetch.mockImplementation(
    async (path) =>
      new Response(
        JSON.stringify(
          path === "/api/catalog"
            ? []
            : { id: "player", nickname: "Recovered" },
        ),
      ),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "重新載入題庫" }));
  });
  expect(screen.getByRole("textbox", { name: "排行榜暱稱" })).toHaveValue(
    "Recovered",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
