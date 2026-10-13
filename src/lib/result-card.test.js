import { expect, test, vi } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  createResultCard,
  drawResultCard,
  fitText,
  resultFacts,
  wrapText,
} from "./result-card.js";
const receipt = {
  id: "abc",
  type: "solo",
  mode: "endless",
  nickname: "黑膠挑戰者",
  score: 1800,
  correct: 2,
  played: 3,
  settings: { region: "tw", category: "girl", decade: "2010s" },
  outcome: "solo",
  roundScores: [
    { round: 1, points: 1000, correct: true },
    { round: 2, points: 800, correct: true },
    { round: 3, points: 0, correct: false },
  ],
  roundScoresTotal: 3,
};
function context() {
  const texts = [];
  return {
    texts,
    font: "20px Arial",
    fillStyle: "",
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 20);
      return { width: Array.from(String(text)).length * size * 0.5 };
    },
    fillText(value) {
      texts.push(String(value));
    },
    fillRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    save() {},
    restore() {},
    arc() {},
    translate() {},
    rotate() {},
    drawImage() {},
  };
}
test("facts use real played counts and handle zero played without invented accuracy", () => {
  expect(resultFacts(receipt)).toMatchObject({
    score: "1,800",
    accuracy: 67,
    correct: 2,
    played: 3,
    region: "華語",
    decade: "2010 年代",
    voice: "女聲",
    mode: "無限挑戰",
  });
  expect(resultFacts({ ...receipt, played: 0, correct: 0 }).accuracy).toBe(0);
});
test("long names wrap at grapheme-safe codepoint boundaries and stay within line limits", () => {
  const ctx = context();
  const lines = wrapText(
    ctx,
    "很長的名字🎵LongEnglishNicknameWithoutSpaces",
    100,
    2,
  );
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("…");
  for (const line of lines)
    expect(ctx.measureText(line).width).toBeLessThanOrEqual(100);
  expect(fitText(ctx, "Short", 100)).toBe("Short");
});
test("canvas draws official solo stats, and duel cards draw both real player scores", () => {
  const solo = context();
  drawResultCard(solo, receipt, {}, "https://music.example");
  expect(solo.texts).toContain("1,800");
  expect(solo.texts).toContain("67%");
  expect(solo.texts).toContain("2 / 3");
  expect(solo.texts.join(" ")).not.toMatch(/排名|Top|前.*%/);
  const duel = context();
  drawResultCard(
    duel,
    {
      ...receipt,
      type: "duel",
      outcome: "draw",
      players: [
        { nickname: "A", score: 1800, correct: 2, played: 3, isYou: true },
        { nickname: "B", score: 1800, correct: 2, played: 3, isYou: false },
      ],
    },
    {},
    "https://music.example",
  );
  expect(duel.texts).toContain("旗鼓相當，平手");
  expect(duel.texts).toContain("A（你）");
  expect(duel.texts).toContain("B");
  expect(duel.texts.filter((value) => value === "1,800")).toHaveLength(3);
});
test("PNG generation waits for fonts and uses only the local brand SVG", async () => {
  let fontsReady;
  const previous = document.fonts;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: new Promise((resolve) => {
        fontsReady = resolve;
      }),
    },
  });
  const sources = [];
  vi.stubGlobal(
    "Image",
    class {
      set src(value) {
        sources.push(value);
        queueMicrotask(() => this.onload());
      }
    },
  );
  const blob = new Blob(["png"], { type: "image/png" }),
    ctx = context(),
    canvas = {
      getContext: () => ctx,
      toBlob: vi.fn((callback) => callback(blob)),
    };
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag) =>
    tag === "canvas" ? canvas : original(tag),
  );
  try {
    const task = createResultCard(receipt, "https://music.example");
    await Promise.resolve();
    expect(sources).toEqual([]);
    fontsReady();
    expect(await task).toBe(blob);
    expect(canvas.width).toBe(CARD_WIDTH);
    expect(canvas.height).toBe(CARD_HEIGHT);
    expect(sources).toEqual(["/images/music-challenge-mark.svg"]);
    expect(canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/png",
    );
  } finally {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: previous,
    });
    vi.unstubAllGlobals();
  }
});

test("party PNG uses the actual podium and total attendance, without inventing a host score", () => {
  const party = {
    ...receipt,
    type: "party",
    mode: "party",
    isHost: true,
    nickname: "Host only",
    score: 0,
    correct: 0,
    totalRounds: 5,
    players: Array.from({ length: 50 }, (_, index) => ({
      nickname: `Party player ${index + 1}`,
      rank: index + 1,
      score: 5000 - index * 50,
      correct: 5,
      played: 5,
    })),
  };
  expect(resultFacts(party)).toMatchObject({
    mode: "派對搶答",
    participants: 50,
    rounds: 5,
    score: null,
    accuracy: null,
    outcome: "全員集結，冠軍揭曉",
  });
  const ctx = context();
  drawResultCard(ctx, party, {}, "https://music.example");
  expect(ctx.texts).toContain("Party player 1");
  expect(ctx.texts).toContain("Party player 2");
  expect(ctx.texts).toContain("Party player 3");
  expect(ctx.texts).not.toContain("Party player 4");
  expect(ctx.texts).not.toContain("Host only");
  expect(ctx.texts).not.toContain("0%");
  expect(ctx.texts).toContain("50 位參賽者 · 5 首歌 · 華語");
  expect(ctx.texts.join(" ")).toContain("完整 50 人排名");
});

test("party PNG has no invented winner for an empty party and preserves long name lines", () => {
  const empty = context();
  drawResultCard(
    empty,
    { ...receipt, type: "party", players: [], totalRounds: 0 },
    {},
    "https://music.example",
  );
  expect(empty.texts).toContain("尚無參賽者戰果");
  expect(empty.texts).not.toContain("CHAMPION");
  const name = "這是一個超級熱愛韓國華語音樂的挑戰者";
  const ctx = context();
  drawResultCard(
    ctx,
    {
      ...receipt,
      type: "party",
      players: [{ rank: 1, nickname: name, score: 5000 }],
      totalRounds: 5,
    },
    {},
    "https://music.example",
  );
  expect(ctx.texts.join("")).toContain(name);
});
