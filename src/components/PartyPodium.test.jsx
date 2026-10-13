import { test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PartyPodium, { rankedPlayers } from "./PartyPodium.jsx";
const players = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index}`,
  rank: index + 1,
  nickname: `玩家${index + 1}`,
  score: 5000 - index * 500,
  correct: 5 - Math.floor(index / 2),
  played: 5,
}));
test("podium presents real top three in second-first-third order", () => {
  const { container } = render(
    <PartyPodium players={[...players].reverse()} rounds={5} />,
  );
  expect(
    screen
      .getAllByRole("article")
      .map((item) => item.getAttribute("aria-label")),
  ).toEqual([
    "第 2 名 玩家2，4,500 分",
    "第 1 名 玩家1，5,000 分",
    "第 3 名 玩家3，4,000 分",
  ]);
  expect(container.querySelector(".party-fireworks")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(
    rankedPlayers([
      { nickname: "Low", score: 100 },
      { nickname: "High", score: 900 },
    ])[0],
  ).toMatchObject({ nickname: "High", rank: 1 });
});
test("mobile participant strip pages through everybody including podium winners", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  });
  const user = userEvent.setup();
  render(<PartyPodium players={players} rounds={5} compact />);
  const roster = screen.getByRole("list", { name: "全部參賽者排名" });
  expect(within(roster).getAllByRole("listitem")).toHaveLength(3);
  expect(within(roster).getByText("玩家1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一頁參賽者" }));
  expect(within(roster).getByText("玩家4")).toBeVisible();
  expect(within(roster).queryByText("玩家1")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一頁參賽者" }));
  expect(within(roster).getAllByRole("listitem")).toHaveLength(2);
  expect(within(roster).getByText("玩家8")).toBeVisible();
  expect(screen.getByRole("button", { name: "下一頁參賽者" })).toBeDisabled();
});
test("fewer than three participants never create placeholder winners", () => {
  const { rerender, container } = render(
    <PartyPodium players={[players[0]]} rounds={5} />,
  );
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article")).toHaveClass("party-award--1");
  rerender(<PartyPodium players={[]} rounds={0} />);
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.getByText("還沒有參賽者戰果。")).toBeVisible();
  expect(container.querySelector(".party-fireworks")).not.toBeInTheDocument();
});
test("long CJK names retain full accessible names and title text", () => {
  const name = "這是一個超級熱愛韓國華語音樂的挑戰者";
  render(<PartyPodium players={[{ ...players[0], nickname: name }]} />);
  expect(screen.getByRole("article")).toHaveAccessibleName(
    expect.stringContaining(name),
  );
  expect(screen.getAllByTitle(name)).toHaveLength(2);
});
