import { beforeEach, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import DuelPage from "./DuelPage.jsx";
import { validRoomCode } from "../lib/room-client.js";
import { readPlayerName, savePlayerName } from "../lib/player-name.js";

vi.mock("../components/PreviewPlayer.jsx", () => ({
  default: ({ onPlaybackStarted, onExtend, disabled, extendDisabled }) => (
    <div>
      <button
        disabled={disabled}
        onClick={() => onPlaybackStarted({ duration: 30 })}
      >
        播放試聽
      </button>
      <button disabled={extendDisabled} onClick={onExtend}>
        延長片段
      </button>
    </div>
  ),
}));
const self = {
  id: "a",
  nickname: "A",
  revision: 1,
  score: 0,
  stage: 0,
  clipSeconds: 1,
  points: 1000,
  heard: false,
  done: false,
  ready: false,
};
const base = {
  code: "ABC123",
  revision: 1,
  mode: "classic",
  settings: { region: "kr", category: "all", decade: "all" },
  status: "playing",
  round: 1,
  totalRounds: 5,
  hostId: "a",
  me: self,
  players: [
    {
      id: "a",
      nickname: "A",
      score: 0,
      done: false,
      ready: false,
      connected: true,
    },
    {
      id: "b",
      nickname: "B",
      score: 0,
      done: false,
      ready: false,
      connected: true,
    },
  ],
  preview: { id: "opaque", preview: "https://audio.example/test.m4a" },
  answer: null,
  results: null,
};
let snapshot, calls, source;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {};
  if (!HTMLDialogElement.prototype.close)
    HTMLDialogElement.prototype.close = function () {};
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function () {
      this.setAttribute("open", "");
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(
    function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  );
  snapshot = structuredClone(base);
  calls = [];
  source = null;
  vi.stubGlobal(
    "EventSource",
    class {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        source = this;
      }
      addEventListener(name, callback) {
        this.listeners[name] = callback;
      }
      close() {}
      emit(value) {
        this.listeners.state({ data: JSON.stringify(value) });
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, body, method: options.method || "GET" });
      let data;
      if (url === "/api/player")
        data = { id: "a", nickname: body?.nickname || "A" };
      else if (url === "/api/catalog")
        data = [
          {
            id: 123,
            title: "Test Song",
            artist: "Singer",
            region: "kr",
            category: "boy",
            year: 2021,
          },
        ];
      else if (url === "/api/rooms") data = { ...snapshot, status: "waiting" };
      else if (String(url).endsWith("/play")) {
        snapshot = {
          ...snapshot,
          revision: 2,
          me: { ...snapshot.me, revision: 2, heard: true },
        };
        data = snapshot;
      } else if (String(url).endsWith("/guess")) {
        snapshot = {
          ...snapshot,
          revision: 3,
          me: { ...snapshot.me, revision: 3, done: true },
        };
        data = snapshot;
      } else if (String(url).endsWith("/join")) {
        snapshot = { ...snapshot, me: { ...self }, status: "playing" };
        data = snapshot;
      } else if (String(url).endsWith("/ready")) {
        snapshot = {
          ...snapshot,
          revision: 5,
          me: { ...snapshot.me, revision: 5, ready: true },
        };
        data = snapshot;
      } else if (String(url).endsWith("/finish")) {
        snapshot = {
          ...snapshot,
          revision: 6,
          status: "finished",
          endedBy: { id: "a", nickname: "A" },
          answer: null,
          preview: null,
        };
        data = snapshot;
      } else data = snapshot;
      return new Response(JSON.stringify(data));
    }),
  );
});
function open(path = "/duel/ABC123", context) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route path="/duel" element={<DuelPage />} />
          <Route path="/duel/:code" element={<DuelPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
test("nickname edits persist before starting and survive a fresh server guest", async () => {
  const user = userEvent.setup();
  savePlayerName("記住我");
  const page = open("/duel");
  const input = await screen.findByRole("textbox", { name: "你的暱稱" });
  expect(input).toHaveValue("記住我");
  await user.clear(input);
  await user.type(input, "黑膠挑戰者");
  expect(readPlayerName()).toBe("黑膠挑戰者");
  expect(
    calls.some((call) => call.url === "/api/player" && call.method === "PATCH"),
  ).toBe(false);
  page.unmount();
  open("/duel");
  expect(await screen.findByRole("textbox", { name: "你的暱稱" })).toHaveValue(
    "黑膠挑戰者",
  );
});
test("active rooms hide shell navigation, expose help, and restore navigation when closed", async () => {
  const setGameActive = vi.fn(),
    showHelp = vi.fn();
  const user = userEvent.setup();
  const page = open("/duel/ABC123", { setGameActive, showHelp });
  await user.click(await screen.findByRole("button", { name: "玩法說明" }));
  expect(showHelp).toHaveBeenCalledOnce();
  expect(setGameActive).toHaveBeenLastCalledWith(true);
  source.emit({ ...snapshot, revision: 10, status: "closed" });
  await screen.findByRole("heading", { name: "房間已關閉" });
  expect(setGameActive).toHaveBeenLastCalledWith(false);
  page.unmount();
  expect(setGameActive).toHaveBeenLastCalledWith(false);
});
test("unmounting an active room restores shell navigation", async () => {
  const setGameActive = vi.fn();
  const page = open("/duel/ABC123", { setGameActive });
  await screen.findByRole("button", { name: "播放試聽" });
  await waitFor(() => expect(setGameActive).toHaveBeenLastCalledWith(true));
  page.unmount();
  expect(setGameActive).toHaveBeenLastCalledWith(false);
});
test.each(["PiZtXwT4wiYJ", "aB_cD-eF12", "abcdefghijklmnopqrstuvwxyz123456"])(
  "preserves case and URL-safe symbols for room %s",
  async (code) => {
    snapshot.code = code;
    open(`/duel/${code}`);
    await screen.findByRole("button", { name: "播放試聽" });
    expect(calls.some((call) => call.url === `/api/rooms/${code}`)).toBe(true);
    await waitFor(() => expect(source?.url).toBe(`/api/rooms/${code}/events`));
  },
);
test("query-string invites preserve case and URL-safe symbols", async () => {
  const code = "Ab_cD-Ef12";
  snapshot.code = code;
  open(`/duel?room=${code}`);
  await screen.findByRole("button", { name: "播放試聽" });
  await waitFor(() => expect(source?.url).toBe(`/api/rooms/${code}/events`));
});
test.each(["short", "a".repeat(33), "abcdef/", "abc def", "Abcd?ef"])(
  "rejects malformed room code %s",
  (code) => expect(validRoomCode(code)).toBe(false),
);
test("host setup is two compact steps and creates selected room settings", async () => {
  const user = userEvent.setup();
  open("/duel");
  await user.click(await screen.findByRole("button", { name: "無限對決" }));
  await user.click(screen.getByRole("button", { name: "選擇曲庫" }));
  await user.click(screen.getByRole("button", { name: "華語" }));
  await user.click(screen.getByRole("button", { name: "女聲" }));
  await user.click(screen.getByRole("button", { name: "2010–2019" }));
  await user.click(screen.getByRole("button", { name: "開房間・邀請朋友" }));
  await waitFor(() =>
    expect(calls.find((call) => call.url === "/api/rooms")?.body).toEqual({
      mode: "endless",
      region: "tw",
      category: "girl",
      decade: "2010s",
    }),
  );
});
test("an invitation requires explicit joining before opening the private event stream", async () => {
  snapshot = { ...snapshot, me: null, status: "waiting" };
  source = null;
  const user = userEvent.setup();
  open();
  await screen.findByRole("button", { name: "加入對戰" });
  expect(source).toBeNull();
  await user.click(screen.getByRole("button", { name: "加入對戰" }));
  await screen.findByRole("button", { name: "播放試聽" });
  await waitFor(() => expect(source?.url).toBe("/api/rooms/ABC123/events"));
});
test("play marks heard; completed answer waits without revealing until both players finish", async () => {
  const user = userEvent.setup();
  open();
  const input = await screen.findByRole("combobox");
  expect(input).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "播放試聽" }));
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "My guess");
  await user.click(screen.getByRole("button", { name: /送出/ }));
  await screen.findByRole("heading", { name: "已完成作答" });
  expect(screen.queryByText("這首歌是")).not.toBeInTheDocument();
  expect(calls.find((call) => call.url.endsWith("/guess"))?.body).toEqual({
    answer: "My guess",
    revision: 2,
  });
  snapshot = {
    ...snapshot,
    revision: 4,
    status: "revealed",
    answer: {
      title: "Test Song",
      artist: "Singer",
      url: "https://music.apple.com/tw/song/123",
    },
    results: [
      {
        id: "a",
        nickname: "A",
        points: 1000,
        total: 1000,
        previousTotal: 0,
        correct: true,
      },
      {
        id: "b",
        nickname: "B",
        points: 800,
        total: 800,
        previousTotal: 0,
        correct: true,
      },
    ],
  };
  source.emit(snapshot);
  await screen.findByRole("heading", { name: "Test Song" });
  expect(
    screen.getByLabelText("本題 1000 分，累積 1000 分"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "準備" }));
  await screen.findByRole("button", { name: "已準備" });
  expect(screen.getByRole("button", { name: "已準備" })).toBeDisabled();
  expect(
    screen.getByRole("heading", { name: "第 1 首 / 5" }),
  ).toBeInTheDocument();
});
test("a late snapshot never rolls back newer room state", async () => {
  open();
  await screen.findByRole("button", { name: "播放試聽" });
  await waitFor(() => expect(source?.url).toBe("/api/rooms/ABC123/events"));
  source.emit({ ...snapshot, revision: 10, status: "closed" });
  await screen.findByRole("heading", { name: "房間已關閉" });
  source.emit({ ...snapshot, revision: 2, status: "playing" });
  expect(
    screen.getByRole("heading", { name: "房間已關閉" }),
  ).toBeInTheDocument();
});
test("disconnect blocks guesses, a fresh event restores the same round", async () => {
  snapshot.me.heard = true;
  open();
  const input = await screen.findByRole("combobox");
  await waitFor(() => expect(source?.url).toBe("/api/rooms/ABC123/events"));
  source.onerror();
  await waitFor(() => expect(input).toBeDisabled());
  expect(screen.getByText(/正在重新連線/)).toBeInTheDocument();
  source.emit({ ...snapshot, revision: 2 });
  await waitFor(() => expect(input).toBeEnabled());
  expect(
    screen.getByRole("heading", { name: "第 1 首 / 5" }),
  ).toBeInTheDocument();
});
test("ending requires confirmation and immediately shows the initiator's settlement", async () => {
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: "結束" }));
  expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
  expect(screen.getByRole("alertdialog").tagName).toBe("DIALOG");
  expect(screen.getByRole("button", { name: "繼續挑戰" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "確認結束" }));
  await screen.findByRole("heading", { name: "對戰結算" });
  expect(calls.some((call) => call.url.endsWith("/finish"))).toBe(true);
  expect(screen.getByRole("button", { name: "分享戰果" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "播放試聽" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
test("opponent ending replaces an open end prompt with one acknowledgment then settlement", async () => {
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: "結束" }));
  snapshot = {
    ...snapshot,
    revision: 20,
    status: "finished",
    endedBy: { id: "b", nickname: "小明" },
    answer: null,
    preview: null,
  };
  source.emit(snapshot);
  const notice = await screen.findByRole("alertdialog", { name: "對戰已結束" });
  expect(notice).toHaveTextContent("小明 已結束對戰，請查看分數。");
  expect(screen.getByRole("button", { name: "確認" })).toHaveFocus();
  expect(
    screen.queryByRole("button", { name: "分享戰果" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "播放試聽" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "確認" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "分享戰果" })).toBeInTheDocument();
  source.emit({ ...base, revision: 2, status: "playing" });
  expect(screen.getByRole("heading", { name: "對戰結算" })).toBeInTheDocument();
});
test("acknowledged opponent settlement stays acknowledged after reload", async () => {
  snapshot = {
    ...snapshot,
    status: "finished",
    endedBy: { id: "b", nickname: "B" },
    answer: null,
    preview: null,
  };
  const user = userEvent.setup(),
    page = open();
  await user.click(await screen.findByRole("button", { name: "確認" }));
  page.unmount();
  open();
  await screen.findByRole("button", { name: "分享戰果" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
test("ending a waiting room shows an explicit zero-point settlement without audio or answer area", async () => {
  snapshot = {
    ...snapshot,
    status: "waiting",
    players: [{ ...snapshot.players[0], played: 0, correct: 0 }],
    preview: null,
  };
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: "結束" }));
  await user.click(screen.getByRole("button", { name: "確認結束" }));
  await screen.findByRole("heading", { name: "對戰結算" });
  expect(screen.getByText("0 / 0 首猜中")).toBeInTheDocument();
  expect(screen.getByText("挑戰尚未開始，已結算。")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "分享戰果" })).toHaveLength(1);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
test.each(["classic", "endless"])(
  "revealed %s rooms place end before ready",
  async (mode) => {
    snapshot = {
      ...snapshot,
      status: "revealed",
      mode,
      answer: null,
      results: [],
    };
    open();
    const ready = await screen.findByRole("button", { name: "準備" });
    const controls = ready.closest(".duel-round-actions");
    expect(controls.firstElementChild).toHaveTextContent("結束");
    expect(controls.lastElementChild).toBe(ready);
  },
);
test("canceling the native leave dialog preserves the room and restores focus", async () => {
  const user = userEvent.setup();
  open();
  const leave = await screen.findByRole("button", { name: "結束" });
  expect(
    screen.queryByRole("link", { name: "回首頁" }),
  ).not.toBeInTheDocument();
  await user.click(leave);
  fireEvent(
    screen.getByRole("alertdialog"),
    new Event("cancel", { cancelable: true }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  expect(leave).toHaveFocus();
  expect(calls.some((call) => call.url.endsWith("/finish"))).toBe(false);
});
test("opponent departure closes an outstanding confirmation and removes the player", async () => {
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: "結束" }));
  source.emit({
    ...snapshot,
    revision: 9,
    status: "closed",
    closedBy: { id: "b", nickname: "B" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("對手已離開");
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "播放試聽" }),
  ).not.toBeInTheDocument();
  expect(calls.some((call) => call.url.endsWith("/finish"))).toBe(false);
});
test("failed leave remains in the modal for retry", async () => {
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) =>
      String(url).endsWith("/finish")
        ? Promise.resolve(
            new Response(JSON.stringify({ error: "連線失敗，請重試。" }), {
              status: 503,
            }),
          )
        : original(url, options),
    ),
  );
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: "結束" }));
  await user.click(screen.getByRole("button", { name: "確認結束" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "連線失敗，請重試。",
  );
  expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "確認結束" })).toBeEnabled();
});
test("active browser navigation prompts without closing room and disconnects never trigger leave", async () => {
  const page = open();
  await screen.findByRole("button", { name: "播放試聽" });
  const before = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  source.onerror();
  await screen.findByText(/正在重新連線/);
  expect(calls.some((call) => call.url.endsWith("/finish"))).toBe(false);
  page.unmount();
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
test("both scores sit directly above the preview within its stage", async () => {
  snapshot.players[0].score = 1800;
  snapshot.players[1].score = 800;
  open();
  const play = await screen.findByRole("button", { name: "播放試聽" });
  const stage = play.closest(".duel-stage");
  const score = screen.getByLabelText("累積 1800 分");
  expect(stage).toContainElement(score);
  expect(stage.firstElementChild).toHaveClass("duel-players");
});
