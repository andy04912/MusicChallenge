import { randomBytes, createHash, randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { makePartyPatch } from "./party-wire.mjs";
import {
  createPartyService,
  roomTimeouts,
  ROOM_TIMEOUTS,
} from "./party-service.mjs";

export function partyJoinOrigins(
  req,
  {
    production = false,
    configuredOrigin = process.env.APP_ORIGIN,
    interfaces = networkInterfaces(),
  } = {},
) {
  if (production || configuredOrigin) return [];
  let requestURL;
  try {
    requestURL = new URL(`http://${req.headers.host}`);
  } catch {
    return [];
  }
  if (!["localhost", "127.0.0.1"].includes(requestURL.hostname)) return [];
  const port = requestURL.port || req.socket?.localPort || 80;
  const addresses = Object.values(interfaces)
    .flat()
    .filter(
      (entry) =>
        entry &&
        !entry.internal &&
        (entry.family === "IPv4" || entry.family === 4),
    )
    .map((entry) => entry.address)
    .filter((address) => {
      const octets = address.split(".").map(Number);
      return (
        octets.length === 4 &&
        octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255) &&
        (octets[0] === 10 ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168))
      );
    });
  return [...new Set(addresses)]
    .slice(0, 10)
    .map((address) => `http://${address}:${port}`);
}

const fail = (status, message) => Object.assign(new Error(message), { status });
const norm = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, "");
const tiers = [
  [1, 1000],
  [6, 800],
  [12, 600],
  [18, 400],
  [24, 200],
  [Infinity, 100],
];
const fresh = () => ({
  revision: 0,
  score: 0,
  played: 0,
  correct: 0,
  stage: 0,
  duration: 30,
  heard: false,
  done: false,
  ready: false,
  lastResult: null,
  feedback: "",
});
const stages = (duration) => {
  const out = [];
  for (const [seconds, points] of tiers) {
    out.push({ seconds: Math.min(seconds, duration), points });
    if (seconds >= duration) break;
  }
  return out;
};
const shuffle = (input) => {
  const out = [...input];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
function settings(input) {
  const value = {
    mode: input.mode ?? "classic",
    region: input.region ?? "kr",
    category: input.category ?? "all",
    decade: input.decade ?? "all",
  };
  if (
    !["classic", "endless"].includes(value.mode) ||
    !["tw", "kr"].includes(value.region) ||
    !["all", "boy", "girl", "other"].includes(value.category) ||
    !["all", "2000s", "2010s", "2020s"].includes(value.decade)
  )
    throw fail(400, "遊戲設定不正確。");
  return value;
}
export function createGameService({
  db,
  getPublishedSongs,
  getPublishedSong,
  now = () => Date.now(),
  timeouts = ROOM_TIMEOUTS,
}) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS game_players(id TEXT PRIMARY KEY,tokenHash TEXT UNIQUE NOT NULL,nickname TEXT NOT NULL); CREATE TABLE IF NOT EXISTS game_states(id TEXT PRIMARY KEY,kind TEXT NOT NULL,value TEXT NOT NULL,updatedAt INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS game_scores(id TEXT PRIMARY KEY,playerId TEXT NOT NULL,nickname TEXT NOT NULL,mode TEXT NOT NULL,region TEXT NOT NULL,decade TEXT NOT NULL,category TEXT NOT NULL,score INTEGER NOT NULL,correct INTEGER NOT NULL,played INTEGER NOT NULL,createdAt INTEGER NOT NULL);`,
  );
  db.exec(`CREATE TABLE IF NOT EXISTS game_results (
    id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, playerId TEXT NOT NULL,
    value TEXT NOT NULL, UNIQUE(sessionId, playerId)
  );`);
  const listeners = new Map();
  const deadlines = roomTimeouts(listeners, now, timeouts);
  const party = createPartyService({
    db,
    getPublishedSongs,
    getPublishedSong,
    now,
    timeouts,
  });
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const save = (s) => {
    s.history = s.history.slice(s.kind === "room" ? -100 : -50);
    return db
      .prepare("INSERT OR REPLACE INTO game_states VALUES (?,?,?,?)")
      .run(s.id, s.kind, JSON.stringify(s), now());
  };
  const read = (id, allowParty = false) => {
    const row = db
      .prepare("SELECT value,updatedAt FROM game_states WHERE id=?")
      .get(id);
    if (!row) throw fail(404, "找不到這場遊戲。");
    const state = JSON.parse(row.value);
    state.lastActivityAt ??= row.updatedAt;
    if (state.kind === "party" && !allowParty)
      throw fail(404, "找不到這場遊戲。");
    // Upgrade active games created before counters were stored independently.
    for (const member of state.members) {
      const history = state.history.filter(
        (entry) => state.kind === "run" || entry.playerId === member.id,
      );
      member.played ??= history.length;
      member.correct ??= history.filter((entry) => entry.correct).length;
    }
    if (state.kind === "room" && state.status === "closed") {
      // Older rooms already banked their completed rounds before closing.
      // Do not retroactively award a pending answer from that old protocol.
      state.status = "finished";
      state.endedBy = state.closedBy || null;
    }
    return state;
  };
  function player(token, create = true) {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const found = db
        .prepare("SELECT id,nickname FROM game_players WHERE tokenHash=?")
        .get(digest(token));
      if (found) return { player: found };
    }
    if (!create) return { player: null };
    const id = randomBytes(12).toString("base64url"),
      secret = randomBytes(32).toString("base64url"),
      nickname = `玩家 ${id.slice(0, 4)}`;
    db.prepare("INSERT INTO game_players VALUES (?,?,?)").run(
      id,
      digest(secret),
      nickname,
    );
    return { player: { id, nickname }, token: secret };
  }
  function rename(p, input) {
    const nickname = typeof input === "string" ? input.trim() : "";
    if (!nickname || [...nickname].length > 20 || /[\p{C}]/u.test(nickname))
      throw fail(400, "暱稱請使用 1 至 20 個字。");
    db.prepare("UPDATE game_players SET nickname=? WHERE id=?").run(
      nickname,
      p.id,
    );
    return { ...p, nickname };
  }
  function create(kind, p, input) {
    const config = settings(input);
    const pool = getPublishedSongs().filter(
      (song) =>
        song.region === config.region &&
        (config.category === "all" || song.category === config.category) &&
        (config.decade === "all" ||
          (Number(song.year) >= Number(config.decade.slice(0, 4)) &&
            Number(song.year) < Number(config.decade.slice(0, 4)) + 10)),
    );
    const unique = [
      ...new Map(
        pool.map((song) => [`${norm(song.title)}|${norm(song.artist)}`, song]),
      ).values(),
    ];
    if (!unique.length) throw fail(400, "這個分類還沒有開放歌曲，請換個條件。");
    const id =
      kind === "room"
        ? randomBytes(9).toString("base64url")
        : randomBytes(18).toString("base64url");
    const state = {
      id,
      kind,
      revision: 0,
      mode: config.mode,
      settings: {
        region: config.region,
        category: config.category,
        decade: config.decade,
      },
      status: kind === "room" ? "waiting" : "playing",
      hostId: p.id,
      round: 1,
      totalRounds:
        config.mode === "classic" ? Math.min(5, unique.length) : null,
      pool: unique,
      deck: shuffle(unique),
      cursor: 0,
      roundId: randomBytes(12).toString("base64url"),
      members: [{ ...p, ...fresh() }],
      history: [],
      createdAt: now(),
      lastActivityAt: now(),
    };
    save(state);
    if (kind === "room") deadlines.track(state);
    return view(state, p.id);
  }
  function song(s) {
    return s.deck[s.cursor];
  }
  function member(s, id) {
    const m = s.members.find((m) => m.id === id);
    if (!m) throw fail(403, "請先加入這個房間。");
    return m;
  }
  function view(s, id) {
    const mine = s.members.find((m) => m.id === id),
      reveal = ["revealed", "finished"].includes(s.status),
      terminalRoom = s.kind === "room" && s.status === "finished";
    const visibleResult = (m) => {
      const result = terminalRoom
        ? s.history.findLast(
            (entry) => entry.playerId === m.id && entry.round === s.round,
          )
        : m.lastResult;
      return result ? { points: result.points, correct: result.correct } : null;
    };
    const base = {
      id: s.id,
      revision: s.revision,
      mode: s.mode,
      settings: s.settings,
      status: s.status,
      round: s.round,
      totalRounds: s.totalRounds,
      preview:
        mine && !terminalRoom && !["waiting", "closed"].includes(s.status)
          ? { id: s.roundId, preview: song(s).preview }
          : null,
      answer: mine && reveal && !terminalRoom ? song(s) : null,
    };
    const visible = (m) => {
      const tier = stages(m.duration)[m.stage];
      return {
        id: m.id,
        nickname: m.nickname,
        revision: m.revision,
        score: m.score,
        correct: m.correct,
        played: m.played,
        stage: m.stage,
        clipSeconds: tier.seconds,
        duration: m.duration,
        canExtend:
          s.status === "playing" &&
          !m.done &&
          m.stage < stages(m.duration).length - 1,
        points: tier.points,
        heard: m.heard,
        done: m.done,
        ready: m.ready,
        feedback: m.feedback,
        lastResult: reveal ? visibleResult(m) : null,
      };
    };
    if (s.kind === "run") {
      const m = member(s, id);
      return {
        ...base,
        ...visible(m),
        id: s.id,
        revision: m.revision,
        played: m.played,
        correct: m.correct,
        history: s.history,
      };
    }
    return {
      ...base,
      code: s.id,
      hostId: s.hostId,
      closedBy: s.closedBy || null,
      endedBy: s.endedBy || null,
      endReason: s.endReason || null,
      me: mine ? visible(mine) : null,
      players: s.members.map((m) => ({
        id: m.id,
        nickname: m.nickname,
        score: m.score,
        correct: m.correct,
        played: m.played,
        done: m.done,
        ready: m.ready,
        connected: !!listeners.get(s.id)?.has(m.id),
      })),
      results:
        mine && reveal
          ? s.members.map((m) => ({
              id: m.id,
              nickname: m.nickname,
              points: visibleResult(m)?.points ?? 0,
              correct: !!visibleResult(m)?.correct,
              total: m.score,
              previousTotal: m.score - (visibleResult(m)?.points ?? 0),
            }))
          : null,
    };
  }
  function emit(s) {
    for (const [id, callbacks] of listeners.get(s.id) || [])
      for (const callback of callbacks) callback(view(s, id));
  }
  function write(s) {
    s.lastActivityAt = now();
    s.revision++;
    save(s);
  }
  // Persist state and score records in one commit before notifying both clients.
  function atomic(operation, id) {
    db.exec("BEGIN IMMEDIATE");
    let result;
    try {
      result = operation();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    emit(read(id));
    if (read(id).status === "finished") deadlines.forget(id);
    return result;
  }
  function scoreRecord(s, m) {
    if (!m.played) return;
    db.prepare(
      "INSERT OR IGNORE INTO game_scores VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `${s.id}:${m.id}`,
      m.id,
      m.nickname,
      s.mode,
      s.settings.region,
      s.settings.decade,
      s.settings.category,
      m.score,
      m.correct,
      m.played,
      now(),
    );
  }
  function resolveRound(s, m, correct) {
    m.done = true;
    m.lastResult = {
      correct,
      points: correct ? stages(m.duration)[m.stage].points : 0,
    };
    m.feedback = "";
    if (s.kind === "run") {
      m.score += m.lastResult.points;
      m.played++;
      m.correct += Number(correct);
      s.history.push({ round: s.round, ...m.lastResult, song: song(s) });
      s.status = "revealed";
    } else if (s.members.length === 2 && s.members.every((m) => m.done)) {
      settleRoomRound(s);
      s.status = "revealed";
    }
  }
  function settleRoomRound(s) {
    for (const player of s.members) {
      const result =
        player.done && player.lastResult
          ? player.lastResult
          : { points: 0, correct: false };
      player.lastResult = result;
      player.score += result.points;
      player.played++;
      player.correct += Number(result.correct);
      s.history.push({ round: s.round, playerId: player.id, ...result });
    }
  }
  function endRoom(s, actor) {
    if (s.status === "playing" && s.members.some((player) => player.done))
      settleRoomRound(s);
    s.status = "finished";
    s.endedBy = { id: actor.id, nickname: actor.nickname };
    for (const player of s.members) {
      player.ready = false;
      player.done = true;
      scoreRecord(s, player);
    }
  }
  function advance(s) {
    if (s.totalRounds && s.round >= s.totalRounds) {
      s.status = "finished";
      for (const m of s.members) scoreRecord(s, m);
      return;
    }
    s.round++;
    s.cursor++;
    if (s.cursor >= s.deck.length) {
      const previous = song({ ...s, cursor: s.cursor - 1 });
      s.deck = shuffle(s.pool);
      if (s.deck.length > 1 && s.deck[0].id === previous.id)
        [s.deck[0], s.deck[1]] = [s.deck[1], s.deck[0]];
      s.cursor = 0;
    }
    s.roundId = randomBytes(12).toString("base64url");
    s.status = "playing";
    for (const m of s.members)
      Object.assign(m, {
        ...fresh(),
        score: m.score,
        played: m.played,
        correct: m.correct,
        revision: m.revision + 1,
      });
  }
  function mutate(id, p, action, input = {}) {
    const s = read(id),
      m = member(s, p.id);
    if (!Number.isInteger(input.revision) || input.revision !== m.revision)
      throw fail(409, "遊戲已更新，請重新讀取。");
    if (["closed", "finished"].includes(s.status))
      throw fail(409, "這場遊戲已結束。");
    if (s.kind === "room" && ["leave", "finish"].includes(action)) {
      endRoom(s, m);
    } else if (action === "leave") {
      s.status = "closed";
      s.closedBy = { id: m.id, nickname: m.nickname };
      for (const player of s.members) scoreRecord(s, player);
    } else if (action === "finish") {
      s.status = "finished";
      for (const player of s.members) scoreRecord(s, player);
    } else if (action === "ready" || action === "next") {
      if (s.status !== "revealed") throw fail(409, "請先完成這一首。");
      if (s.kind === "run") advance(s);
      else {
        if (m.ready) throw fail(409, "你已準備好，請等候另一位玩家。");
        m.ready = true;
        if (s.members.every((player) => player.ready)) advance(s);
      }
    } else {
      if (s.status !== "playing" || m.done)
        throw fail(409, "請等候另一位玩家。");
      if (action === "play") {
        if (
          !m.heard &&
          m.stage === 0 &&
          Number.isFinite(input.duration) &&
          input.duration > 0
        )
          m.duration = Math.max(0.1, Math.min(90, input.duration));
        m.heard = true;
      } else if (action === "extend") {
        if (m.stage >= stages(m.duration).length - 1)
          throw fail(409, "已經是完整試聽。");
        m.stage++;
        m.feedback = "";
      } else if (action === "reveal") resolveRound(s, m, false);
      else if (action === "guess") {
        if (!m.heard) throw fail(409, "請先播放片段。");
        if (
          typeof input.answer !== "string" ||
          input.answer.length > 300 ||
          !norm(input.answer)
        )
          throw fail(400, "請輸入歌名。");
        const target = song(s),
          selected = Number.isSafeInteger(input.songId)
            ? getPublishedSongs().find((song) => song.id === input.songId)
            : null;
        const correct = Number.isSafeInteger(input.songId)
          ? !!selected &&
            norm(selected.title) === norm(target.title) &&
            norm(selected.artist) === norm(target.artist)
          : norm(input.answer) === norm(target.title);
        if (correct || m.stage === stages(m.duration).length - 1)
          resolveRound(s, m, correct);
        else {
          m.stage++;
          m.feedback = "還沒猜中，片段已延長。";
        }
      } else throw fail(404, "找不到這個操作。");
    }
    m.revision++;
    write(s);
    return view(s, p.id);
  }
  function join(id, p) {
    const s = read(id);
    if (s.kind !== "room") throw fail(404, "找不到房間。");
    if (s.members.some((m) => m.id === p.id)) return view(s, p.id);
    if (s.status !== "waiting" || s.members.length >= 2)
      throw fail(409, "房間已滿或已結束。");
    s.members.push({ ...p, ...fresh() });
    deadlines.track(s);
    s.status = "playing";
    write(s);
    return view(s, p.id);
  }
  function canSubscribe(id, p) {
    expire(id);
    const s = read(id);
    if (s.kind !== "room") throw fail(404, "找不到房間。");
    member(s, p.id);
    if ((listeners.get(id)?.get(p.id)?.size || 0) >= 4)
      throw fail(429, "此玩家已開啟太多對戰連線。");
    return view(s, p.id);
  }
  function subscribe(id, p, callback) {
    const snapshot = canSubscribe(id, p);
    if (snapshot.status === "finished") {
      callback(snapshot);
      return () => {};
    }
    const s = read(id);
    let room = listeners.get(id);
    if (!room) {
      room = new Map();
      listeners.set(id, room);
    }
    let set = room.get(p.id);
    if (!set) {
      set = new Set();
      room.set(p.id, set);
    }
    set.add(callback);
    deadlines.connected(id, p.id);
    emit(s);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      set.delete(callback);
      if (!set.size) room.delete(p.id);
      if (!room.size) listeners.delete(id);
      const latest = read(id);
      if (latest.status !== "finished") deadlines.disconnected(id, p.id);
      emit(latest);
    };
  }
  function expire(id) {
    const state = read(id);
    if (state.kind !== "room") return;
    const reason = deadlines.reason(state);
    if (!reason) return;
    atomic(() => {
      endRoom(state, { id: "system", nickname: "系統" });
      state.endReason = reason;
      write(state);
    }, id);
  }
  function sweep() {
    for (const { id } of db
      .prepare(
        "SELECT id FROM game_states WHERE kind='room' AND json_extract(value, '$.status') IN ('waiting','playing','revealed')",
      )
      .all())
      expire(id);
    party.sweep();
  }
  function leaderboard({
    mode = "classic",
    region,
    decade,
    offset = 0,
    limit = 5,
  } = {}) {
    if (!["classic", "endless"].includes(mode)) throw fail(400, "模式不正確。");
    const where = ["mode=?"],
      params = [mode];
    if (region && ["tw", "kr"].includes(region)) {
      where.push("region=?");
      params.push(region);
    }
    if (decade && ["all", "2000s", "2010s", "2020s"].includes(decade)) {
      where.push("decade=?");
      params.push(decade);
    }
    offset = Math.max(0, Math.min(10000, Number(offset) || 0));
    limit = Math.max(1, Math.min(20, Number(limit) || 5));
    const rows = db
      .prepare(
        `SELECT * FROM game_scores WHERE ${where.join(" AND ")} ORDER BY score DESC,correct DESC,played DESC,createdAt ASC`,
      )
      .all(...params);
    const byPlayer = new Map();
    for (const row of rows)
      if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, row);
    const best = [...byPlayer.values()];
    return {
      entries: best.slice(offset, offset + limit).map((row, index) => ({
        rank: offset + index + 1,
        nickname: row.nickname,
        score: row.score,
        correct: row.correct,
        played: row.played,
        mode: row.mode,
        region: row.region,
        decade: row.decade,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      hasMore: best.length > offset + limit,
      total: best.length,
    };
  }
  function result(id) {
    const row = db.prepare("SELECT value FROM game_results WHERE id=?").get(id);
    if (!row) throw fail(404, "找不到這份成績。");
    return JSON.parse(row.value);
  }
  function createResult(p, input) {
    if (
      typeof input.sessionId !== "string" ||
      !/^[A-Za-z0-9_-]{6,32}$/.test(input.sessionId)
    )
      throw fail(400, "遊戲編號不正確。");
    const state = read(input.sessionId, true);
    if (state.kind === "party") {
      const data = party.resultData(state, p);
      const existing = db
        .prepare(
          "SELECT value FROM game_results WHERE sessionId=? AND playerId=?",
        )
        .get(state.id, p.id);
      if (existing) return JSON.parse(existing.value);
      const receipt = {
        id: randomBytes(18).toString("base64url"),
        createdAt: new Date(now()).toISOString(),
        ...data,
      };
      db.prepare(
        "INSERT INTO game_results (id,sessionId,playerId,value) VALUES (?,?,?,?)",
      ).run(receipt.id, state.id, p.id, JSON.stringify(receipt));
      return receipt;
    }
    const owner = member(state, p.id);
    if (state.status !== "finished")
      throw fail(409, "請先完成這場挑戰，再分享成績。");
    const existing = db
      .prepare(
        "SELECT value FROM game_results WHERE sessionId=? AND playerId=?",
      )
      .get(state.id, p.id);
    if (existing) return JSON.parse(existing.value);
    const history = state.history.filter(
      (entry) => state.kind === "run" || entry.playerId === p.id,
    );
    const opponents = state.members.filter((player) => player.id !== p.id);
    const opponentScore = opponents.length
      ? Math.max(...opponents.map((player) => player.score))
      : owner.score;
    // Explicit allowlist: never persist song answers, preview URLs, session IDs,
    // player identifiers, cookies or any mutable client-supplied score fields.
    const receipt = {
      id: randomBytes(18).toString("base64url"),
      createdAt: new Date(now()).toISOString(),
      type: state.kind === "run" ? "solo" : "duel",
      mode: state.mode,
      settings: {
        region: state.settings.region,
        category: state.settings.category,
        decade: state.settings.decade,
      },
      nickname: owner.nickname,
      score: owner.score,
      correct: owner.correct,
      played: owner.played,
      totalRounds: state.totalRounds,
      roundScores: history.slice(-20).map((entry) => ({
        round: entry.round,
        points: entry.points,
        correct: entry.correct,
      })),
      roundScoresTotal: owner.played,
      players: state.members.map((player) => ({
        nickname: player.nickname,
        score: player.score,
        correct: player.correct,
        played: player.played,
        isYou: player.id === p.id,
      })),
      outcome:
        state.kind === "run"
          ? "solo"
          : owner.score > opponentScore
            ? "win"
            : owner.score < opponentScore
              ? "loss"
              : "draw",
    };
    db.prepare(
      "INSERT INTO game_results (id,sessionId,playerId,value) VALUES (?,?,?,?)",
    ).run(receipt.id, state.id, p.id, JSON.stringify(receipt));
    return receipt;
  }
  return {
    party,
    player,
    rename,
    create,
    mutate: (id, p, action, input) => {
      expire(id);
      return atomic(() => mutate(id, p, action, input), id);
    },
    join: (id, p) => {
      expire(id);
      return atomic(() => join(id, p), id);
    },
    canSubscribe,
    subscribe,
    sweep,
    leaderboard,
    result,
    createResult,
    get: (id, p) => {
      expire(id);
      return view(read(id), p.id);
    },
    close: () => {
      listeners.clear();
      deadlines.clear();
      party.close();
    },
  };
}

export function createGameplayHandler({
  db,
  getPublishedSongs,
  getPublishedSong,
  body,
  json,
  sameOrigin,
  production,
  now = () => Date.now(),
  timeouts = ROOM_TIMEOUTS,
}) {
  const service = createGameService({
      db,
      getPublishedSongs,
      getPublishedSong,
      now,
      timeouts,
    }),
    limits = new Map(),
    streams = new Set();
  const maintenance = setInterval(() => {
    try {
      service.sweep();
    } catch (error) {
      console.error("Room cleanup failed:", error.message);
    }
  }, 10_000);
  maintenance.unref();
  function openStream(res, subscribe, snapshot, compact = false) {
    // HTTP 204 tells EventSource not to reconnect an already-finished room.
    if (["finished", "closed"].includes(snapshot.status)) {
      res.writeHead(204);
      res.end();
      return;
    }
    let stopped = false,
      heartbeat,
      unsubscribe = () => {};
    function cleanup() {
      if (stopped) return;
      stopped = true;
      clearInterval(heartbeat);
      streams.delete(finish);
      unsubscribe();
    }
    function finish() {
      cleanup();
      res.end();
    }
    function write(chunk) {
      if (stopped || res.destroyed || res.writableEnded) return;
      if (res.writableLength > 262144) {
        cleanup();
        res.destroy();
        return;
      }
      res.write(chunk);
    }
    // Install cleanup before subscribing: initial/final snapshots may close the
    // stream synchronously, and navigation can cancel it during establishment.
    res.on("close", cleanup);
    res.on("error", cleanup);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    write("retry: 2000\n\n");
    streams.add(finish);
    let previous;
    unsubscribe = subscribe((state) => {
      const terminal = ["finished", "closed"].includes(state.status);
      const patch = compact && previous && !terminal;
      const payload = patch ? makePartyPatch(previous, state) : state;
      write(
        `event: ${patch ? "patch" : "state"}\ndata: ${JSON.stringify(payload)}\n\n`,
      );
      previous = state;
      if (["finished", "closed"].includes(state.status)) {
        write("event: closed\ndata: {}\n\n");
        finish();
      }
    });
    if (stopped) unsubscribe();
    else {
      heartbeat = setInterval(() => write("event: ping\ndata: {}\n\n"), 15000);
      heartbeat.unref();
    }
  }
  function identity(req, res, create = false) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("music_player="))
      ?.slice(13);
    const result = service.player(token, create);
    if (result.token)
      res.setHeader(
        "Set-Cookie",
        `music_player=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000${production ? "; Secure" : ""}`,
      );
    return result.player;
  }
  function throttle(id, maximum = 180) {
    const time = Date.now();
    let item = limits.get(id);
    if (!item || item.until < time) {
      item = { until: time + 60000, count: 0 };
      limits.set(id, item);
    }
    if (++item.count > maximum) throw fail(429, "操作太頻繁，請稍候。");
    if (limits.size > 5000)
      for (const [key, value] of limits)
        if (value.until < time) limits.delete(key);
  }
  return {
    service,
    close() {
      clearInterval(maintenance);
      for (const finish of [...streams]) finish();
      service.close();
    },
    async handle(req, res, url) {
      const path = url.pathname,
        method = req.method;
      if (
        !/^\/api\/(?:player|runs|rooms|parties|leaderboard|config|results)(?:\/|$)/.test(
          path,
        )
      )
        return false;
      if (path === "/api/config" && method === "GET") {
        let donationUrl = null;
        try {
          const u = new URL(process.env.BUY_ME_A_COFFEE_URL);
          if (
            u.protocol === "https:" &&
            ["buymeacoffee.com", "www.buymeacoffee.com"].includes(u.hostname) &&
            !u.username &&
            !u.password &&
            u.pathname !== "/"
          )
            donationUrl = u.href;
        } catch {}
        json(res, 200, {
          donationUrl,
          partyJoinOrigins: partyJoinOrigins(req, { production }),
        });
        return true;
      }
      if (path === "/api/leaderboard" && method === "GET") {
        json(
          res,
          200,
          service.leaderboard(Object.fromEntries(url.searchParams)),
        );
        return true;
      }
      if (path.startsWith("/api/results/") && method === "GET") {
        const match = path.match(/^\/api\/results\/([A-Za-z0-9_-]{24})$/);
        if (!match) throw fail(404, "找不到這份成績。");
        json(res, 200, service.result(match[1]));
        return true;
      }
      if (!["GET", "HEAD"].includes(method)) sameOrigin(req);
      // Bound anonymous identity churn as well as each established player's writes.
      throttle(`ip:${req.socket.remoteAddress}`, 10000);
      const p = identity(req, res, path === "/api/player" && method === "GET");
      const publicRoomRead =
        method === "GET" &&
        /^\/api\/(?:rooms|parties)\/[A-Za-z0-9_-]{6,32}$/.test(path);
      if (!p && !publicRoomRead)
        throw fail(401, "請重新開啟遊戲以建立玩家身分。");
      if (method !== "GET") throttle(p.id);
      if (path === "/api/player" && method === "GET") {
        json(res, 200, p);
        return true;
      }
      if (path === "/api/player" && method === "PATCH") {
        json(res, 200, service.rename(p, (await body(req)).nickname));
        return true;
      }
      if (path === "/api/results" && method === "POST") {
        json(res, 200, service.createResult(p, await body(req)));
        return true;
      }
      if (path === "/api/parties" && method === "POST") {
        throttle(`create:${p.id}`, 20);
        json(res, 201, service.party.create(p, await body(req)));
        return true;
      }
      if (path.startsWith("/api/parties/")) {
        const match = path.match(
          /^\/api\/parties\/(P[A-Za-z0-9_-]{15})(?:\/(join|events|start|guess|giveup|reveal|next|finish))?$/,
        );
        if (!match) throw fail(404, "找不到派對功能。");
        const [, code, action] = match;
        if (method === "GET" && !action) {
          json(res, 200, service.party.get(code, p || { id: "" }));
          return true;
        }
        if (method === "GET" && action === "events") {
          const snapshot = service.party.canSubscribe(code, p);
          openStream(
            res,
            (callback) => service.party.subscribe(code, p, callback),
            snapshot,
            url.searchParams.get("compact") === "1",
          );
          return true;
        }
        if (method === "POST" && action) {
          const input = await body(req);
          json(
            res,
            200,
            action === "join"
              ? service.party.join(code, p)
              : service.party.mutate(code, p, action, input),
          );
          return true;
        }
        throw fail(404, "找不到派對功能。");
      }
      if (
        (path === "/api/runs" || path === "/api/rooms") &&
        method === "POST"
      ) {
        throttle(`create:${p.id}`, 20);
        json(
          res,
          201,
          service.create(
            path.endsWith("rooms") ? "room" : "run",
            p,
            await body(req),
          ),
        );
        return true;
      }
      const match = path.match(
        /^\/api\/(runs|rooms)\/([A-Za-z0-9_-]{6,32})(?:\/(play|guess|extend|reveal|next|ready|finish|leave|join|events))?$/,
      );
      if (!match) throw fail(404, "找不到遊戲功能。");
      const [, kind, id, action] = match;
      if (method === "GET" && !action) {
        json(res, 200, service.get(id, p || { id: "" }));
        return true;
      }
      if (kind === "rooms" && method === "GET" && action === "events") {
        const snapshot = service.canSubscribe(id, p);
        openStream(
          res,
          (callback) => service.subscribe(id, p, callback),
          snapshot,
        );
        return true;
      }
      if (method === "POST" && action) {
        const input = await body(req);
        json(
          res,
          200,
          action === "join"
            ? service.join(id, p)
            : service.mutate(id, p, action, input),
        );
        return true;
      }
      throw fail(404, "找不到遊戲功能。");
    },
  };
}
