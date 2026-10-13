import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GamePage from "./GamePage.jsx";

const songs = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  title: `Song ${index}`,
  artist: "BLACKPINK",
  region: "kr",
  category: "girl",
  year: "2024",
  preview: "https://audio-ssl.itunes.apple.com/test.m4a",
  artwork: "https://example.mzstatic.com/100x100bb.jpg",
  url: "https://music.apple.com/tw/song/1",
  album: "Album",
}));
const tiers = [1, 6, 12, 18, 24, 30],
  points = [1000, 800, 600, 400, 200, 100];
let state, calls;
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
function fresh(
  mode = "classic",
  settings = { region: "kr", category: "all", decade: "all" },
) {
  return {
    id: "run-test",
    revision: 0,
    mode,
    settings,
    status: "playing",
    round: 1,
    totalRounds: mode === "classic" ? 5 : null,
    score: 0,
    correct: 0,
    played: 0,
    stage: 0,
    clipSeconds: 1,
    points: 1000,
    heard: false,
    feedback: "",
    preview: { id: "round-1", preview: songs[0].preview },
    answer: null,
    lastResult: null,
    history: [],
  };
}
function mockServer(catalog = songs) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : {};
      calls.push({ url, method: options.method || "GET", body });
      if (url === "/api/catalog") return response(catalog);
      if (url === "/api/player")
        return response({
          id: "player-test",
          nickname: body.nickname || "Tester",
        });
      if (url === "/api/runs") {
        state = fresh(body.mode, body);
        return response(state);
      }
      if (url === "/api/runs/run-test") return response(state);
      if (url.startsWith("https:")) return new Response(new ArrayBuffer(8));
      const action = url.split("/").at(-1);
      if (body.revision !== state.revision)
        return new Response(JSON.stringify({ error: "狀態已更新" }), {
          status: 409,
        });
      state = { ...state, revision: state.revision + 1 };
      if (action === "play") state.heard = true;
      if (
        action === "extend" ||
        (action === "guess" &&
          body.answer !== songs[(state.round - 1) % songs.length].title &&
          state.stage < 5)
      ) {
        state.stage++;
        state.clipSeconds = tiers[state.stage];
        state.points = points[state.stage];
        state.feedback = "再聽一點，片段已延長。";
      } else if (action === "reveal" || action === "guess") {
        const song = songs[(state.round - 1) % songs.length],
          correct = action === "guess" && body.answer === song.title;
        const result = {
          round: state.round,
          correct,
          points: correct ? state.points : 0,
          song,
        };
        state.status = "revealed";
        state.answer = song;
        state.lastResult = result;
        state.history = [...state.history, result];
        state.score += result.points;
        state.played++;
        state.correct += Number(correct);
      }
      if (action === "next") {
        if (state.totalRounds && state.round === state.totalRounds)
          state.status = "finished";
        else {
          state.round++;
          state.status = "playing";
          state.preview = {
            id: `round-${state.round}`,
            preview: songs[0].preview,
          };
          state.answer = null;
          state.lastResult = null;
          state.stage = 0;
          state.clipSeconds = 1;
          state.points = 1000;
          state.heard = false;
          state.feedback = "";
        }
      }
      if (action === "finish") state.status = "finished";
      return response(state);
    }),
  );
}
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state = null;
  calls = [];
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      async resume() {}
      async close() {}
      async decodeAudioData() {
        return { duration: 30 };
      }
      createBufferSource() {
        return { connect() {}, disconnect() {}, start() {}, stop() {} };
      }
    },
  );
  mockServer();
});
async function begin(user, mode = "classic") {
  await screen.findByDisplayValue("Tester");
  if (mode === "endless")
    await user.click(screen.getByRole("button", { name: /無限挑戰/ }));
  await user.click(screen.getByRole("button", { name: /下一步：選擇歌曲/ }));
  await user.click(screen.getByRole("button", { name: "開始猜歌" }));
  await screen.findByRole("combobox");
}
async function play(user) {
  await user.click(await screen.findByRole("button", { name: "播放試聽" }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
}

test("two-step setup sends nickname and intersecting library filters to the server", async () => {
  mockServer([
    ...songs,
    ...songs.map((song) => ({
      ...song,
      id: song.id + 20,
      region: "tw",
      category: "boy",
      year: "2004",
    })),
  ]);
  const user = userEvent.setup();
  render(<GamePage />);
  await screen.findByDisplayValue("Tester");
  await user.clear(screen.getByLabelText("排行榜暱稱"));
  await user.type(screen.getByLabelText("排行榜暱稱"), "Music fan");
  await user.click(screen.getByRole("button", { name: "華語" }));
  await user.click(screen.getByRole("button", { name: /下一步：選擇歌曲/ }));
  await user.click(screen.getByRole("button", { name: "男聲／男團" }));
  await user.click(screen.getByRole("button", { name: "2000–2009" }));
  await user.click(screen.getByRole("button", { name: "開始猜歌" }));
  await screen.findByRole("combobox");
  expect(
    calls.find((call) => call.url === "/api/player" && call.method === "PATCH")
      .body,
  ).toEqual({ nickname: "Music fan" });
  expect(calls.find((call) => call.url === "/api/runs").body).toEqual({
    mode: "classic",
    region: "tw",
    category: "boy",
    decade: "2000s",
  });
});

test("play authorizes once; wrong guesses use authoritative tier and correct answer uses server score", async () => {
  const user = userEvent.setup();
  render(<GamePage />);
  await begin(user);
  expect(screen.getByRole("combobox")).toBeDisabled();
  await play(user);
  await user.click(screen.getByRole("button", { name: "暫停試聽" }));
  await play(user);
  expect(calls.filter((call) => call.url.endsWith("/play"))).toHaveLength(1);
  expect(calls.find((call) => call.url.endsWith("/play")).body).toEqual({
    revision: 0,
    duration: 30,
  });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "wrong" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  await waitFor(() =>
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "6"),
  );
  expect(screen.getByRole("combobox")).toHaveValue("");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Song 0" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  await screen.findByText("答對了！ +800 分");
  expect(
    calls
      .filter((call) => call.url.endsWith("/guess"))
      .map((call) => call.body.revision),
  ).toEqual([1, 2]);
  expect(
    screen.getByRole("link", { name: "在 Apple Music 聆聽" }),
  ).toHaveAttribute("href", expect.stringContaining("app=music"));
});

test("endless continues after five songs and explicit finish records a bounded paginated result", async () => {
  const user = userEvent.setup();
  render(<GamePage />);
  await begin(user, "endless");
  for (let index = 0; index < 6; index++) {
    await user.click(screen.getByRole("button", { name: "不知道，揭曉答案" }));
    await user.click(await screen.findByRole("button", { name: "下一首" }));
    await screen.findByRole("combobox");
  }
  expect(state.round).toBe(7);
  await user.click(screen.getByRole("button", { name: "結束挑戰" }));
  await screen.findByRole("heading", { name: "這一輪，聽得漂亮。" });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByText("Song 0")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一頁歌曲" }));
  expect(screen.getByText("Song 2")).toBeVisible();
  expect(screen.queryByText("Song 0")).not.toBeInTheDocument();
  expect(sessionStorage.getItem("music-challenge-active-run")).toBeNull();
});

test("classic finishes after exactly five questions and can return to setup", async () => {
  const user = userEvent.setup();
  render(<GamePage />);
  await begin(user);
  for (let index = 0; index < 5; index++) {
    await user.click(screen.getByRole("button", { name: "不知道，揭曉答案" }));
    await user.click(
      await screen.findByRole("button", {
        name: index === 4 ? "看看本輪成績" : "下一首",
      }),
    );
    if (index < 4) await screen.findByRole("combobox");
  }
  await screen.findByRole("heading", { name: "這一輪，聽得漂亮。" });
  expect(state.played).toBe(5);
  await user.click(screen.getByRole("button", { name: "再挑戰一次" }));
  expect(
    screen.getByRole("button", { name: /下一步：選擇歌曲/ }),
  ).toBeVisible();
});

test("reload resumes a server run and does not start a fresh challenge", async () => {
  state = {
    ...fresh("endless"),
    round: 8,
    score: 2400,
    heard: true,
    stage: 2,
    clipSeconds: 12,
    points: 600,
    revision: 19,
  };
  sessionStorage.setItem("music-challenge-active-run", state.id);
  render(<GamePage />);
  await screen.findByRole("combobox");
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "12");
  expect(screen.getByLabelText("累積 2,400 分")).toHaveTextContent("2,400");
  expect(calls.some((call) => call.url === "/api/runs")).toBe(false);
});

test("initial network failure offers retry without creating a scored run", async () => {
  const normal = fetch;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("網路暫時中斷"))
      .mockImplementation(normal),
  );
  const user = userEvent.setup();
  render(<GamePage />);
  await user.click(await screen.findByRole("button", { name: "重新載入題庫" }));
  await screen.findByDisplayValue("Tester");
  expect(calls.some((call) => call.url === "/api/runs")).toBe(false);
});

test("a lost guess response recovers the scored server snapshot without submitting twice", async () => {
  const user = userEvent.setup();
  render(<GamePage />);
  await begin(user);
  await play(user);
  const normal = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      const result = await normal(url, options);
      if (url.endsWith("/guess")) throw new Error("回應中斷，已同步最新狀態");
      return result;
    }),
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Song 0" },
  });
  await user.click(screen.getByRole("button", { name: "送出答案" }));
  await screen.findByText("答對了！ +1,000 分");
  expect(calls.filter((call) => call.url.endsWith("/guess"))).toHaveLength(1);
  expect(state.score).toBe(1000);
  expect(screen.getByRole("button", { name: "下一首" })).toBeEnabled();
});

test("touch players do not get an automatic keyboard after playing or extending", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query.includes("pointer: coarse"),
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = userEvent.setup();
  render(<GamePage />);
  await begin(user);
  await play(user);
  expect(screen.getByRole("combobox")).not.toHaveFocus();
  await user.click(screen.getByRole("button", { name: "延長片段" }));
  await waitFor(() =>
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "6"),
  );
  expect(screen.getByRole("combobox")).not.toHaveFocus();
});

test("classic setup counts unique titles and artists and matches shorter server rounds", async () => {
  mockServer([
    songs[0],
    { ...songs[0], id: 101, title: "SONG 0" },
    { ...songs[0], id: 102, title: "Song-0", artist: "BLACK PINK" },
    songs[1],
    { ...songs[1], id: 103 },
    { ...songs[1], id: 104 },
  ]);
  const user = userEvent.setup();
  render(<GamePage />);
  await screen.findByDisplayValue("Tester");
  await user.click(screen.getByRole("button", { name: /下一步：選擇歌曲/ }));
  expect(screen.getByText("經典 2 首 · K-POP")).toBeVisible();
  expect(screen.queryByText(/首可挑戰/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "不限", exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "開始猜歌" })).toBeEnabled();
});

test("nickname edits survive remount before a run starts", async () => {
  const user = userEvent.setup();
  const first = render(<GamePage />);
  await screen.findByDisplayValue("Tester");
  await user.clear(screen.getByLabelText("排行榜暱稱"));
  await user.type(screen.getByLabelText("排行榜暱稱"), "我的暱稱");
  first.unmount();
  render(<GamePage />);
  await waitFor(() => expect(screen.getByLabelText("排行榜暱稱")).toBeEnabled());
  expect(screen.getByLabelText("排行榜暱稱")).toHaveValue("我的暱稱");
  expect(calls.some(call => call.method === "PATCH")).toBe(false);
});
