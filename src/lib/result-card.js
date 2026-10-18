export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
const ink = "#202024",
  paper = "#f5f1e8",
  pink = "#ee83aa";
const number = (value) =>
  Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
export function resultFacts(result) {
  const played = number(result.played),
    correct = number(result.correct);
  return {
    score:
      result.type === "party" && result.isHost
        ? null
        : number(result.score).toLocaleString("en-US"),
    accuracy:
      result.type === "party" && result.isHost
        ? null
        : played
          ? Math.round((correct / played) * 100)
          : 0,
    played,
    correct,
    region: result.settings?.region === "tw" ? "華語" : "K-POP",
    voice:
      { all: "不限聲音", girl: "女聲", boy: "男聲", other: "男女合唱" }[
        result.settings?.category
      ] || "不限聲音",
    decade:
      { "2000s": "2000 年代", "2010s": "2010 年代", "2020s": "2020 年代" }[
        result.settings?.decade
      ] || "不限年代",
    mode:
      result.type === "party"
        ? "派對搶答"
        : `${result.mode === "endless" ? "無限" : "經典"}${result.type === "duel" ? "對戰" : "挑戰"}`,
    participants:
      result.type === "party" ? (result.players || []).length : undefined,
    rounds:
      result.type === "party"
        ? number(result.totalRounds ?? result.played)
        : played,
    outcome:
      result.type === "party"
        ? result.isHost
          ? "全員集結，冠軍揭曉"
          : result.outcome === "win"
            ? "冠軍就是你"
            : "全場一起，聽出精彩"
        : {
            win: "贏下這場對決",
            loss: "下一場，再挑戰",
            draw: "旗鼓相當，平手",
            solo: "這一輪，我的戰果",
          }[result.outcome] || "這一輪，我的戰果",
  };
}
export function fitText(ctx, value, width) {
  const text = String(value ?? "");
  if (ctx.measureText(text).width <= width) return text;
  const letters = Array.from(text);
  while (
    letters.length &&
    ctx.measureText(`${letters.join("")}…`).width > width
  )
    letters.pop();
  return `${letters.join("")}…`;
}
export function wrapText(ctx, value, width, maxLines = 2) {
  const letters = Array.from(String(value ?? "")),
    lines = [];
  let line = "";
  for (let index = 0; index < letters.length; index++) {
    const next = line + letters[index];
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = letters[index];
      if (lines.length === maxLines - 1) {
        lines.push(fitText(ctx, letters.slice(index).join(""), width));
        return lines;
      }
    } else line = next;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
function font(
  ctx,
  size,
  weight = 600,
  family = 'Arial, "PingFang TC", "Microsoft JhengHei", sans-serif',
) {
  ctx.font = `${weight} ${size}px ${family}`;
}
function text(ctx, value, x, y, size = 24, color = ink, weight = 600, width) {
  font(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.fillText(width ? fitText(ctx, value, width) : String(value), x, y);
}
function rect(ctx, x, y, width, height, radius, color) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}
function line(ctx, x, y, end, color = "#c8c0b9") {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(end, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}
function vinyl(ctx, x, y, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  for (let r = radius - 16; r > radius * 0.3; r -= 13) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#f5f1e82a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.29, 0, Math.PI * 2);
  ctx.fillStyle = pink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.restore();
}
function drawPartyCard(ctx, result, logo, origin) {
  const facts = resultFacts(result);
  const players = [...(result.players || [])].sort(
    (a, b) =>
      (Number(a.rank) || Infinity) - (Number(b.rank) || Infinity) ||
      number(b.score) - number(a.score),
  );
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  if (logo) ctx.drawImage(logo, 62, 48, 86, 86);
  text(ctx, "Music Challenge", 170, 90, 43, ink, 700);
  text(ctx, "THE FINAL ENCORE", 173, 123, 17, "#686167", 600);
  line(ctx, 64, 165, 1016, ink);
  rect(ctx, 64, 202, 220, 48, 24, ink);
  text(ctx, "派對搶答 · FINAL", 86, 234, 22, paper, 700);
  text(ctx, "今晚，誰最懂音樂？", 64, 322, 53, ink, 700);
  text(
    ctx,
    `${facts.participants} 位參賽者 · ${facts.rounds} 首歌 · ${facts.region}`,
    68,
    371,
    27,
    "#8d3557",
    700,
  );
  text(ctx, `${facts.decade} · ${facts.voice}`, 68, 408, 21, "#686167", 500);
  vinyl(ctx, 943, 281, 78);
  const positions = [390, 64, 716],
    heights = [440, 326, 244];
  players.slice(0, 3).forEach((player, index) => {
    const x = positions[index],
      top = 996 - heights[index],
      rank = number(player.rank) || index + 1;
    ctx.save();
    ctx.textAlign = "center";
    font(ctx, 26, 700);
    wrapText(ctx, player.nickname, 282, 2).forEach((value, lineIndex) => {
      ctx.fillStyle = ink;
      ctx.fillText(value, x + 150, top - 78 + lineIndex * 31);
    });
    text(
      ctx,
      `${number(player.score).toLocaleString("en-US")} 分`,
      x + 150,
      top - 10,
      25,
      "#8d3557",
      800,
      282,
    );
    rect(
      ctx,
      x,
      top,
      300,
      heights[index],
      15,
      [pink, "#d2c6c8", "#e2c7b8"][index],
    );
    text(
      ctx,
      rank,
      x + 150,
      top + Math.min(150, heights[index] * 0.57),
      index === 0 ? 146 : 112,
      ink,
      800,
    );
    text(
      ctx,
      index === 0 ? "CHAMPION" : "MUSIC CLUB",
      x + 150,
      957,
      17,
      "#644153",
      700,
    );
    ctx.restore();
  });
  if (!players.length) text(ctx, "尚無參賽者戰果", 64, 672, 38, "#686167", 600);
  text(
    ctx,
    `${facts.participants} 位玩家一起挑戰${facts.participants > 3 ? " · 呈現最終前三名" : ""}`,
    64,
    1047,
    23,
    "#686167",
    500,
    952,
  );
  rect(ctx, 0, 1090, 1080, 260, 0, ink);
  text(ctx, "下一場，一起搶答。", 64, 1173, 43, paper, 700);
  text(ctx, "揪朋友，聽一段，爭第一。", 67, 1220, 23, pink, 500);
  text(
    ctx,
    String(origin || "Music Challenge").replace(/^https?:\/\//, ""),
    67,
    1283,
    22,
    paper,
    500,
    855,
  );
}
export function drawResultCard(ctx, result, logo, origin) {
  if (result.type === "party") return drawPartyCard(ctx, result, logo, origin);
  const facts = resultFacts(result);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  if (logo) ctx.drawImage(logo, 62, 48, 86, 86);
  text(ctx, "Music Challenge", 170, 90, 43, ink, 700);
  text(ctx, "LISTEN. GUESS. WIN.", 173, 123, 17, "#686167", 600);
  text(ctx, "MY SCORE", 822, 88, 17, ink, 700);
  text(ctx, "音樂挑戰紀錄", 822, 119, 17, "#686167", 500);
  line(ctx, 64, 165, 1016, ink);
  rect(ctx, 64, 200, 235, 48, 24, ink);
  text(ctx, facts.mode, 88, 232, 23, paper, 700);
  text(ctx, facts.outcome, 64, 293, 25, "#8d3557", 700);
  font(ctx, 48, 700);
  wrapText(ctx, result.nickname || "音樂挑戰者", 600, 2).forEach(
    (value, index) => {
      ctx.fillStyle = ink;
      ctx.fillText(value, 64, 358 + index * 55);
    },
  );
  vinyl(ctx, 930, 415, 190);
  ctx.save();
  ctx.translate(930, 415);
  ctx.rotate(-0.12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  text(ctx, "GUESS", 0, -20, 19, ink, 800);
  text(ctx, "AGAIN", 0, 20, 19, ink, 800);
  ctx.restore();
  let scoreSize = 226;
  font(ctx, scoreSize, 800, '"Barlow Condensed", Arial, sans-serif');
  while (ctx.measureText(facts.score).width > 650 && scoreSize > 40) {
    scoreSize -= 4;
    font(ctx, scoreSize, 800, '"Barlow Condensed", Arial, sans-serif');
  }
  ctx.fillStyle = ink;
  ctx.fillText(facts.score, 56, 602);
  text(ctx, "TOTAL POINTS / 累積分數", 68, 644, 20, "#686167", 600);
  line(ctx, 64, 677, 1016, ink);
  text(ctx, `${facts.correct} / ${facts.played}`, 64, 745, 45, ink, 700);
  text(ctx, "首猜中", 64, 781, 21, "#686167", 500);
  text(ctx, `${facts.accuracy}%`, 414, 745, 45, ink, 700);
  text(ctx, "答對率", 414, 781, 21, "#686167", 500);
  text(ctx, facts.region, 754, 745, 42, ink, 700);
  text(
    ctx,
    `${facts.decade} · ${facts.voice}`,
    754,
    781,
    19,
    "#686167",
    500,
    264,
  );
  if (result.type === "duel") {
    const players = (result.players || []).slice(0, 2);
    players.forEach((player, index) => {
      const x = 64 + index * 488;
      rect(ctx, x, 825, 464, 196, 18, player.isYou ? pink : ink);
      const color = player.isYou ? ink : paper;
      text(
        ctx,
        `${player.nickname}${player.isYou ? "（你）" : ""}`,
        x + 22,
        869,
        25,
        color,
        700,
        420,
      );
      font(ctx, 74, 800, '"Barlow Condensed", Arial, sans-serif');
      ctx.fillStyle = color;
      ctx.fillText(
        fitText(ctx, number(player.score).toLocaleString("en-US"), 420),
        x + 22,
        956,
      );
      text(
        ctx,
        `${number(player.correct)} / ${number(player.played)} 首猜中`,
        x + 22,
        991,
        19,
        color,
        500,
      );
    });
  } else {
    text(ctx, "ROUND BY ROUND", 64, 849, 18, ink, 700);
    const rounds = (result.roundScores || []).slice(-20),
      count = Math.max(rounds.length, 1),
      gap = 10,
      width = (952 - gap * (count - 1)) / count;
    rounds.forEach((round, index) => {
      const height = Math.max(7, (number(round.points) / 1000) * 111),
        x = 64 + index * (width + gap);
      rect(ctx, x, 883, width, 111, Math.min(6, width / 4), "#e6dfd6");
      rect(
        ctx,
        x,
        994 - height,
        width,
        height,
        Math.min(6, width / 4),
        round.correct ? pink : ink,
      );
    });
    if (!rounds.length) text(ctx, "尚無完成題目", 64, 934, 26, "#686167", 500);
    text(
      ctx,
      number(result.roundScoresTotal) > rounds.length
        ? `最近 ${rounds.length} 題 / 共 ${number(result.roundScoresTotal)} 題`
        : `每一道，都是你的節奏。`,
      64,
      1030,
      19,
      "#686167",
      500,
    );
  }
  rect(ctx, 0, 1090, 1080, 260, 0, ink);
  text(ctx, "你的耳朵，能拿幾分？", 64, 1173, 43, paper, 700);
  text(ctx, "聽一小段，猜一首歌。", 67, 1220, 23, pink, 500);
  text(
    ctx,
    String(origin || "Music Challenge").replace(/^https?:\/\//, ""),
    67,
    1283,
    22,
    paper,
    500,
    855,
  );
}
function loadLogo() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("品牌圖示載入失敗，請重試。"));
    image.src = "/images/music-challenge-mark.svg";
  });
}
export async function createResultCard(
  result,
  origin = window.location.origin,
) {
  await document.fonts?.load?.('800 226px "Barlow Condensed"');
  await document.fonts?.ready;
  const logo = await loadLogo(),
    canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("瀏覽器無法產生圖片，仍可複製遊戲連結。");
  drawResultCard(ctx, result, logo, origin);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("圖片產生失敗，請重試。")),
      "image/png",
    ),
  );
}
