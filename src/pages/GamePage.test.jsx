import { test, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GamePage from "./GamePage.jsx";
const songs = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  title: `Song ${i}`,
  artist: "BLACKPINK",
  region: "kr",
  category: "girl",
  preview: "https://audio-ssl.itunes.apple.com/test.m4a",
  url: "https://music.apple.com/tw/song/1",
  artwork: "https://example.mzstatic.com/100x100bb.jpg",
  album: "Test album",
  year: "2026",
}));
test("filters, five rounds, score and replay stay inside the React app", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(songs))),
  );
  const user = userEvent.setup();
  render(<GamePage />);
  await screen.findByRole("button", { name: "開始猜歌" });
  await user.click(screen.getByRole("button", { name: "華語" }));
  expect(screen.getByRole("button", { name: "歌曲準備中" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "K-POP" }));
  await user.click(screen.getByRole("button", { name: "開始猜歌" }));
  await screen.findByRole("combobox", { name: "你的答案" });
  for (let i = 0; i < 5; i++) {
    fireEvent.playing(document.querySelector("audio"));
    await user.type(screen.getByRole("combobox"), "blackpink");
    expect(screen.getAllByRole("option")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: /直接揭曉/ }));
    expect(
      screen.getByRole("link", { name: "在 Apple Music 聆聽" }),
    ).toHaveAttribute("href", expect.stringContaining("app=music"));
    await user.click(
      screen.getByRole("button", { name: i === 4 ? "看看本輪成績" : "下一首" }),
    );
  }
  expect(
    screen.getByRole("heading", { name: "新歌單，已經有了靈感。" }),
  ).toBeVisible();
  expect(screen.getAllByText("已揭曉")).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "再聽一輪" }));
  expect(screen.getByRole("button", { name: "K-POP" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  vi.unstubAllGlobals();
});
test("catalog network failure offers an actionable retry", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(new Response(JSON.stringify(songs)));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<GamePage />);
  await user.click(await screen.findByRole("button", { name: "重新載入題庫" }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeVisible());
  vi.unstubAllGlobals();
});

test("decade choice restricts both rounds and autocomplete and survives returning home", async () => {
  const catalog = [...songs, ...songs.map(song => ({...song, id: song.id + 10, title: `Old ${song.id}`, year: "2004"}))];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalog))));
  const user = userEvent.setup();
  render(<GamePage />);
  await screen.findByRole("button", {name: "開始猜歌"});
  await user.click(screen.getByRole("button", {name: "2010–2019"}));
  expect(screen.getByRole("button", {name: "歌曲準備中"})).toBeDisabled();
  await user.click(screen.getByRole("button", {name: "2000–2009"}));
  await user.click(screen.getByRole("button", {name: "開始猜歌"}));
  await screen.findByRole("combobox");
  fireEvent.playing(document.querySelector("audio"));
  await user.type(screen.getByRole("combobox"), "Song");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("combobox"));
  await user.type(screen.getByRole("combobox"), "Old");
  expect(screen.getAllByRole("option")).toHaveLength(5);
  await user.click(screen.getByRole("button", {name: /直接揭曉/}));
  expect(screen.getByRole("heading", {name: /^Old /})).toBeVisible();
  await user.click(screen.getByRole("button", {name: "回到選曲"}));
  expect(screen.getByRole("button", {name: "2000–2009"})).toHaveAttribute("aria-pressed", "true");
  vi.unstubAllGlobals();
});

test("speed points start with audible playback, never reset on pause/replay, and reset for each new round", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(songs))),
  );
  vi.spyOn(Math, "random").mockReturnValue(0.999);
  let now = 10000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const user = userEvent.setup();
  render(<GamePage />);
  await user.click(await screen.findByRole("button", { name: "開始猜歌" }));
  const audio = () => document.querySelector("audio");
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  fireEvent.play(audio()); // Loading/play intent must not unlock guessing.
  expect(screen.getByRole("combobox")).toBeDisabled();
  fireEvent.playing(audio());
  expect(screen.getByRole("combobox")).toBeEnabled();
  expect(screen.getByRole("img", { name: /旋轉中/ })).toBeVisible();
  now = 10900;
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Song 0" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  expect(screen.getByText("答對了！ +1,000 分")).toBeVisible();
  expect(screen.queryByText("現在答對")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一首" }));
  expect(screen.getByRole("combobox")).toBeDisabled();
  now = 20000;
  fireEvent.playing(audio());
  fireEvent.pause(audio());
  expect(screen.getByRole("img", { name: /已暫停/ })).toBeVisible();
  now = 23000;
  fireEvent.playing(audio()); // Resume must not grant another highest-score window.
  fireEvent.ended(audio());
  fireEvent.playing(audio()); // Neither may replay after the clip ends.
  now = 23500;
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Song 1" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  expect(screen.getByText("答對了！ +600 分")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一首" }));
  now = 30000;
  fireEvent.playing(audio());
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "wrong" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  expect(screen.getByText(/本題 0 分/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一首" }));
  await user.click(screen.getByRole("button", { name: /直接揭曉/ }));
  await user.click(screen.getByRole("button", { name: "下一首" }));
  now = 40000;
  fireEvent.playing(audio());
  now = 80000;
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Song 4" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  await user.click(screen.getByRole("button", { name: "看看本輪成績" }));
  expect(screen.getByText("1,700")).toBeVisible();
  expect(screen.getByText("/ 5,000 分 · 3 / 5 首猜中")).toBeVisible();
  vi.unstubAllGlobals();
});

test("only one music library is playable, and male/female filters intersect it", async () => {
  const catalog = [
    ...songs,
    ...songs.map((s) => ({
      ...s,
      id: s.id + 10,
      title: `華語 ${s.id}`,
      artist: "華語男歌手",
      category: "boy",
      region: "tw",
    })),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(catalog))),
  );
  const user = userEvent.setup();
  render(<GamePage />);
  await screen.findByRole("button", { name: "開始猜歌" });
  expect(
    screen.queryByRole("button", { name: "全部歌曲" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "華語" }));
  await user.click(screen.getByRole("button", { name: "女聲／女團" }));
  expect(screen.getByRole("button", { name: "歌曲準備中" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "男聲／男團" }));
  await user.click(screen.getByRole("button", { name: "開始猜歌" }));
  fireEvent.playing(document.querySelector("audio"));
  await user.type(screen.getByRole("combobox"), "blackpink");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("combobox"));
  await user.type(screen.getByRole("combobox"), "華語男歌手");
  expect(screen.getAllByRole("option")).toHaveLength(5);
  vi.unstubAllGlobals();
});
