import { beforeEach, expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import PartyPage from "./PartyPage.jsx";
import QRCode from "qrcode";
const audio = vi.hoisted(() => ({ engines: [], order: [] }));
vi.mock("../lib/clip-audio.js", () => ({
  ClipAudio: class {
    constructor(url, onState) {
      this.url = url;
      this.onState = onState;
      this.preload = vi.fn(async () => ({ duration: 47.6 }));
      this.pause = vi.fn(() => onState(false));
      this.dispose = vi.fn();
      this.play = vi.fn(async (seconds) => {
        audio.order.push("audio");
        onState(true);
        return { duration: 47.6, limit: 47.6 };
      });
      audio.engines.push(this);
    }
  },
}));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,QR") },
}));
vi.mock("../components/PartyPodium.jsx", () => ({
  default: ({ players }) => (
    <div className="party-podium">
      <h2>派對最終成績</h2>
      {players.map((player) => (
        <p key={player.id}>
          {player.nickname}：{player.score}
        </p>
      ))}
    </div>
  ),
}));
const players = [
  {
    id: "a",
    nickname: "Alice",
    status: "waiting",
    score: 0,
    correct: 0,
    played: 0,
    points: 0,
    place: null,
    rank: 1,
  },
  {
    id: "b",
    nickname: "Bob",
    status: "waiting",
    score: 0,
    correct: 0,
    played: 0,
    points: 0,
    place: null,
    rank: 2,
  },
];
const base = {
  code: "Party_Code12",
  id: "Party_Code12",
  revision: 1,
  status: "lobby",
  round: 1,
  roundId: "round-one",
  hostId: "host",
  isHost: true,
  host: { id: "host", nickname: "Host" },
  hostConnected: true,
  capacity: 50,
  playerCount: 2,
  me: null,
  players,
  settings: { region: "kr", category: "all", decade: "all" },
  preview: { id: "round-one", preview: "https://audio.example/preview.m4a" },
  answer: null,
};
let snapshot, calls, source;
beforeEach(() => {
  localStorage.clear();
  audio.engines.length = 0;
  audio.order.length = 0;
  snapshot = structuredClone(base);
  calls = [];
  source = null;
  HTMLDialogElement.prototype.showModal ||= function () {};
  HTMLDialogElement.prototype.close ||= function () {};
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
  vi.stubGlobal(
    "EventSource",
    class {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        source = this;
      }
      addEventListener(name, fn) {
        this.listeners[name] = fn;
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
        data = { id: "host", nickname: body?.nickname || "Host" };
      else if (url === "/api/config")
        data = { partyJoinOrigins: ["http://192.168.1.20:8080"] };
      else if (url === "/api/catalog")
        data = [
          {
            id: 1,
            title: "One Song",
            artist: "Singer",
            region: "kr",
            category: "girl",
            year: 2021,
          },
        ];
      else if (url === "/api/parties") data = snapshot;
      else if (url.endsWith("/start")) {
        audio.order.push("start");
        snapshot = {
          ...snapshot,
          revision: 2,
          status: "playing",
          players: snapshot.players.map((player) => ({
            ...player,
            status: "guessing",
          })),
        };
        data = snapshot;
      } else if (url.endsWith("/guess")) {
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          me: { ...snapshot.me, feedback: "還沒猜中，再試一次。" },
        };
        data = snapshot;
      } else if (url.endsWith("/giveup")) {
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          me: { ...snapshot.me, status: "gaveup" },
        };
        data = snapshot;
      } else if (url.endsWith("/reveal")) {
        snapshot = {
          ...snapshot,
          revision: 3,
          status: "revealed",
          answer: {
            title: "One Song",
            artist: "Singer",
            url: "https://music.apple.com/tw/song/1",
          },
        };
        data = snapshot;
      } else if (url.endsWith("/next")) {
        snapshot = {
          ...snapshot,
          revision: 4,
          status: "ready",
          round: 2,
          roundId: "round-two",
          preview: { ...snapshot.preview, id: "round-two" },
          answer: null,
        };
        data = snapshot;
      } else if (url.endsWith("/finish")) {
        snapshot = {
          ...snapshot,
          revision: 20,
          status: "finished",
          preview: null,
        };
        data = snapshot;
      } else if (url.endsWith("/join")) {
        snapshot = { ...snapshot, me: { ...players[0] } };
        data = snapshot;
      } else data = snapshot;
      return new Response(JSON.stringify(data));
    }),
  );
});
function open(path = "/party/Party_Code12") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/party" element={<PartyPage />} />
        <Route path="/party/:code" element={<PartyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
test("host preloads full audio, sound starts before guessing opens, and lobby transition keeps the same engine", async () => {
  const user = userEvent.setup();
  open();
  const play = await screen.findByRole("button", { name: "播放並開始作答" });
  await waitFor(() => expect(play).toBeEnabled());
  expect(audio.engines).toHaveLength(1);
  expect(audio.engines[0].play).not.toHaveBeenCalled();
  await user.click(play);
  await screen.findByRole("button", { name: "揭曉答案" });
  expect(audio.order).toEqual(["audio", "start"]);
  expect(audio.engines[0].play).toHaveBeenCalledWith(Infinity);
  expect(audio.engines).toHaveLength(1);
  expect(audio.engines[0].dispose).not.toHaveBeenCalled();
  expect(calls.find((call) => call.url.endsWith("/start"))?.body).toEqual({
    roundId: "round-one",
  });
  expect(screen.getByText(/47.6 秒/)).toBeInTheDocument();
});
test("start API failure stops audio and keeps players from being silently started", async () => {
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((url, options) =>
      url.endsWith("/start")
        ? Promise.resolve(
            new Response(JSON.stringify({ error: "連線失敗" }), {
              status: 503,
            }),
          )
        : original(url, options),
    ),
  );
  const user = userEvent.setup();
  open();
  const play = await screen.findByRole("button", { name: "播放並開始作答" });
  await waitFor(() => expect(play).toBeEnabled());
  await user.click(play);
  await screen.findByText(/尚未開放作答/);
  expect(audio.engines[0].pause).toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "揭曉答案" }),
  ).not.toBeInTheDocument();
});
test("participants never create audio and can retry wrong answers then explicitly give up", async () => {
  snapshot = {
    ...snapshot,
    isHost: false,
    status: "playing",
    me: { ...players[0], status: "guessing" },
    preview: null,
  };
  const user = userEvent.setup();
  open();
  let input = await screen.findByRole("combobox", { name: "你的答案" });
  expect(audio.engines).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: /播放/ }),
  ).not.toBeInTheDocument();
  await user.type(input, "wrong one");
  await user.click(screen.getByRole("button", { name: /送出/ }));
  await screen.findByText("還沒猜中，再試一次。");
  input = screen.getByRole("combobox", { name: "你的答案" });
  await user.type(input, "wrong two");
  await user.click(screen.getByRole("button", { name: /送出/ }));
  await waitFor(() =>
    expect(calls.filter((call) => call.url.endsWith("/guess"))).toHaveLength(2),
  );
  await user.click(screen.getByRole("button", { name: "放棄這題" }));
  await screen.findByRole("heading", { name: "已放棄這題" });
  expect(audio.engines).toHaveLength(0);
});
test("host next round only prepares audio; it never auto starts", async () => {
  snapshot = {
    ...snapshot,
    status: "revealed",
    answer: { title: "One Song", artist: "Singer" },
  };
  const user = userEvent.setup();
  open();
  await user.click(
    await screen.findByRole("button", { name: /下一首・準備播放/ }),
  );
  await screen.findByText("播放後才會開放手機作答。");
  expect(calls.some((call) => call.url.endsWith("/start"))).toBe(false);
  expect(
    audio.engines.every((engine) => engine.play.mock.calls.length === 0),
  ).toBe(true);
});
test("QR uses a reachable LAN origin and preserves the room code", async () => {
  open();
  await screen.findByRole("img", { name: "掃描加入這場派對" });
  // jsdom origin is localhost, matching the local development host.
  expect(QRCode.toDataURL).toHaveBeenCalledWith(
    expect.stringContaining("/party/Party_Code12"),
    expect.any(Object),
  );
  const invite = screen.getByRole("textbox", { name: "派對邀請連結" });
  expect(invite.value).toContain("/party/Party_Code12");
});
test("wrong arrival order still displays server correct order, not cumulative ranking", async () => {
  snapshot = {
    ...snapshot,
    isHost: false,
    status: "playing",
    me: { ...players[0], status: "gaveup" },
    preview: null,
    players: [
      { ...players[0], status: "correct", place: 2, points: 800, score: 3000 },
      { ...players[1], status: "correct", place: 1, points: 1000, score: 1000 },
    ],
  };
  open();
  const list = await screen.findByRole("list");
  expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Bob");
});
test("host finish requires native confirmation and stops audio before showing podium", async () => {
  snapshot = { ...snapshot, status: "playing" };
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: "結束" }));
  expect(screen.getByRole("alertdialog")).toHaveAttribute("open");
  expect(calls.some((call) => call.url.endsWith("/finish"))).toBe(false);
  await user.click(screen.getByRole("button", { name: "結束並頒獎" }));
  await screen.findByRole("heading", { name: "派對最終成績" });
  expect(audio.engines[0].dispose).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "分享戰果" })).toBeInTheDocument();
});
test("host absence preserves participant progress; stale events never replace a finish", async () => {
  snapshot = {
    ...snapshot,
    isHost: false,
    status: "playing",
    me: { ...players[0], status: "guessing" },
    preview: null,
    hostConnected: false,
  };
  open();
  await screen.findByText(/主機暫時離線/);
  await waitFor(() => expect(source).toBeTruthy());
  source.emit({ ...snapshot, revision: 20, status: "finished" });
  await screen.findByRole("heading", { name: "派對最終成績" });
  source.emit({ ...snapshot, revision: 2, status: "playing" });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
test("new players cannot join a full lobby or a running party", async () => {
  snapshot = {
    ...snapshot,
    isHost: false,
    me: null,
    preview: null,
    playerCount: 50,
  };
  const page = open();
  expect(
    await screen.findByRole("button", { name: "派對已額滿" }),
  ).toBeDisabled();
  page.unmount();
  snapshot = { ...snapshot, status: "playing", playerCount: 2 };
  open();
  expect(
    await screen.findByRole("button", { name: "派對已開始，無法加入" }),
  ).toBeDisabled();
  expect(audio.engines).toHaveLength(0);
});
