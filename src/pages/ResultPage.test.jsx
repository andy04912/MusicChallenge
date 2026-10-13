import { beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import ResultPage from "./ResultPage.jsx";
import { createResultCard } from "../lib/result-card.js";
vi.mock("../lib/result-card.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createResultCard: vi.fn(),
}));
const receipt = {
  id: "receipt123",
  type: "solo",
  mode: "classic",
  nickname: "Andy",
  score: 1800,
  correct: 2,
  played: 5,
  settings: { region: "kr", category: "all", decade: "all" },
  outcome: "solo",
  roundScores: [],
};
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(receipt))),
  );
  createResultCard.mockResolvedValue(
    new Blob(["image"], { type: "image/png" }),
  );
  URL.createObjectURL = vi.fn(() => "blob:result-card");
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: vi.fn(() => true),
  });
});
function open() {
  return render(
    <MemoryRouter initialEntries={["/result/receipt123"]}>
      <Routes>
        <Route path="/result/:id" element={<ResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
test("prepares one faithful PNG preview before enabling share and passes cached File synchronously", async () => {
  let finish;
  createResultCard.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  open();
  await screen.findByText("Andy 的戰果");
  expect(screen.getByRole("button", { name: "分享戰果" })).toBeDisabled();
  await act(async () => finish(new Blob(["ready"], { type: "image/png" })));
  const preview = await screen.findByRole("img");
  expect(preview).toHaveAttribute("src", "blob:result-card");
  expect(preview).toHaveAttribute("alt", expect.stringContaining("40%"));
  fireEvent.click(screen.getByRole("button", { name: "分享戰果" }));
  expect(navigator.share).toHaveBeenCalledOnce();
  const payload = navigator.share.mock.calls[0][0];
  expect(payload.files[0]).toBeInstanceOf(File);
  expect(payload.files[0].name).toBe("music-challenge-receipt123.png");
  expect(payload.url).toContain("/result/receipt123");
  expect(createResultCard).toHaveBeenCalledTimes(1);
});
test("canceling native share is quiet; unsupported share keeps download and copy available", async () => {
  navigator.share.mockRejectedValue(
    new DOMException("cancelled", "AbortError"),
  );
  const user = userEvent.setup();
  open();
  await screen.findByRole("img");
  await user.click(screen.getByRole("button", { name: "分享戰果" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "分享戰果" })).toBeEnabled(),
  );
  expect(screen.queryByText(/未能開啟分享/)).not.toBeInTheDocument();
  navigator.canShare.mockReturnValue(false);
  await user.click(screen.getByRole("button", { name: "分享戰果" }));
  expect(screen.getByText(/此瀏覽器不支援分享圖片/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下載圖片" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "複製連結" })).toBeEnabled();
});
test("failed clipboard gives a selected link instead of falsely claiming success", async () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  open();
  await screen.findByRole("img");
  await user.click(screen.getByRole("button", { name: "複製連結" }));
  const input = screen.getByRole("textbox", { name: "戰果連結" });
  expect(input).toHaveFocus();
  expect(input.selectionEnd).toBe(input.value.length);
  expect(screen.getByText(/手動複製/)).toBeInTheDocument();
});
test("export failure retains public link and supports retry, and blob URLs are released", async () => {
  createResultCard.mockRejectedValueOnce(new Error("製作失敗"));
  const user = userEvent.setup(),
    page = open();
  await screen.findByText("製作失敗");
  expect(screen.getByRole("button", { name: "複製連結" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "重新製作圖片" }));
  await screen.findByRole("img");
  page.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:result-card");
});

test("public party receipts show every real participant through pages and share a party PNG", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const party = {
    ...receipt,
    type: "party",
    mode: "party",
    isHost: true,
    score: 0,
    correct: 0,
    totalRounds: 5,
    players: Array.from({ length: 8 }, (_, index) => ({
      rank: index + 1,
      nickname: `Party ${index + 1}`,
      score: 5000 - index * 500,
      correct: 5,
      played: 5,
    })),
  };
  fetch.mockImplementation(async () => new Response(JSON.stringify(party)));
  const user = userEvent.setup();
  open();
  await screen.findByRole("heading", { name: "派對冠軍，正式揭曉。" });
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.queryByText("Andy 的戰果")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一頁參賽者" }));
  expect(screen.getByText("Party 4")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一頁參賽者" }));
  expect(screen.getByText("Party 8")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "分享戰果" })).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "分享戰果" }));
  expect(navigator.share).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "8 人的派對搶答戰果",
      files: [expect.any(File)],
    }),
  );
  expect(createResultCard).toHaveBeenCalledWith(party);
});
