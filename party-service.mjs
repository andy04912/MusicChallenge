import { randomBytes, randomInt } from "node:crypto";
const fail = (status, message) => Object.assign(new Error(message), { status });
const norm = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, "");
const shuffle = (input) => {
  const copy = [...input];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const newRoundId = () => randomBytes(15).toString("base64url");
export function createPartyService({
  db,
  getPublishedSongs,
  now = () => Date.now(),
}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS game_states(id TEXT PRIMARY KEY,kind TEXT NOT NULL,value TEXT NOT NULL,updatedAt INTEGER NOT NULL)",
  );
  const listeners = new Map();
  const save = (s) =>
    db
      .prepare("INSERT OR REPLACE INTO game_states VALUES (?,?,?,?)")
      .run(s.id, "party", JSON.stringify(s), now());
  const read = (id) => {
    const row = db
      .prepare("SELECT value FROM game_states WHERE id=? AND kind='party'")
      .get(id);
    if (!row) throw fail(404, "找不到派對房間。");
    return JSON.parse(row.value);
  };
  const member = (s, p) => s.members.find((m) => m.id === p.id);
  const access = (s, p) => {
    if (p.id !== s.host.id && !member(s, p)) throw fail(403, "請先加入派對。");
  };
  const host = (s, p) => {
    if (p.id !== s.host.id) throw fail(403, "只有主持人可以操作。");
  };
  const ranking = (s) =>
    [...s.members].sort(
      (a, b) =>
        b.score - a.score ||
        b.correct - a.correct ||
        a.orderTotal - b.orderTotal ||
        a.joinOrder - b.joinOrder,
    );
  function view(s, p) {
    const isHost = s.host.id === p.id,
      mine = member(s, p),
      authorized = isHost || !!mine;
    const { preview: _privateAudio, ...publicSong } = s.deck[s.cursor];
    const players = authorized
      ? ranking(s).map((m, i) => ({
          id: m.id,
          nickname: m.nickname,
          status: m.status,
          score: m.score,
          correct: m.correct,
          played: m.played,
          place: m.place,
          points: m.points,
          rank: i + 1,
        }))
      : [];
    return {
      id: s.id,
      code: s.id,
      revision: s.revision,
      status: s.status,
      settings: s.settings,
      round: s.round,
      roundId: s.roundId,
      hostId: authorized ? s.host.id : null,
      host: authorized ? s.host : { nickname: s.host.nickname },
      isHost,
      me: mine
        ? { ...players.find((m) => m.id === p.id), feedback: mine.feedback }
        : null,
      players,
      capacity: 50,
      playerCount: s.members.length,
      hostConnected: !!listeners.get(s.id)?.get(s.host.id)?.size,
      totalRounds: s.status === "finished" ? s.completedRounds : null,
      completedRounds: s.completedRounds,
      preview:
        isHost && s.status !== "finished"
          ? { id: s.roundId, preview: s.deck[s.cursor].preview }
          : null,
      answer:
        authorized && s.status === "revealed"
          ? isHost
            ? s.deck[s.cursor]
            : publicSong
          : null,
      endedBy: authorized ? s.endedBy || null : null,
    };
  }
  function emit(s, onlyPlayer = null) {
    for (const [id, set] of listeners.get(s.id) || [])
      if (!onlyPlayer || id === onlyPlayer)
        for (const callback of set) callback(view(s, { id }));
  }
  function transaction(id, fn, recipient = () => null) {
    db.exec("BEGIN IMMEDIATE");
    let state;
    try {
      state = fn();
      save(state);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    emit(state, recipient());
    return state;
  }
  function create(p, input = {}) {
    const settings = {
      region: input.region ?? "kr",
      category: input.category ?? "all",
      decade: input.decade ?? "all",
    };
    if (
      !["tw", "kr"].includes(settings.region) ||
      !["all", "boy", "girl", "other"].includes(settings.category) ||
      !["all", "2000s", "2010s", "2020s"].includes(settings.decade)
    )
      throw fail(400, "派對設定不正確。");
    const pool = getPublishedSongs().filter(
      (song) =>
        song.region === settings.region &&
        (settings.category === "all" || song.category === settings.category) &&
        (settings.decade === "all" ||
          (Number(song.year) >= Number(settings.decade.slice(0, 4)) &&
            Number(song.year) < Number(settings.decade.slice(0, 4)) + 10)),
    );
    const unique = [
      ...new Map(
        pool.map((song) => [`${norm(song.title)}|${norm(song.artist)}`, song]),
      ).values(),
    ];
    if (!unique.length) throw fail(400, "這個分類還沒有開放歌曲。");
    const state = {
      id: `P${randomBytes(11).toString("base64url")}`,
      kind: "party",
      revision: 0,
      status: "lobby",
      settings,
      host: { id: p.id, nickname: p.nickname },
      hostId: p.id,
      members: [],
      round: 1,
      roundId: newRoundId(),
      completedRounds: 0,
      correctCount: 0,
      pool: unique,
      deck: shuffle(unique),
      cursor: 0,
      history: [],
      createdAt: now(),
    };
    save(state);
    return view(state, p);
  }
  function join(id, p) {
    const original = read(id);
    if (p.id === original.host.id || member(original, p))
      return view(original, p);
    const state = transaction(id, () => {
      const s = read(id);
      if (s.status !== "lobby") throw fail(409, "派對已開始，無法再加入。");
      if (s.members.length >= 50) throw fail(409, "派對已滿，最多 50 位玩家。");
      s.members.push({
        id: p.id,
        nickname: p.nickname,
        joinOrder: s.members.length,
        status: "waiting",
        score: 0,
        correct: 0,
        played: 0,
        orderTotal: 0,
        place: null,
        points: 0,
        feedback: "",
      });
      s.revision++;
      return s;
    });
    return view(state, p);
  }
  function settle(s) {
    if (s.settledRound === s.round) return;
    for (const m of s.members) {
      if (m.status !== "correct") m.status = "gaveup";
      m.played++;
      m.feedback = "";
      s.history.push({
        playerId: m.id,
        round: s.round,
        points: m.points,
        correct: m.status === "correct",
      });
    }
    s.history = s.history.slice(-1000);
    s.completedRounds++;
    s.settledRound = s.round;
    s.status = "revealed";
  }
  function mutate(id, p, action, input = {}) {
    let notifyOnly = null;
    const state = transaction(
      id,
      () => {
        const s = read(id);
        access(s, p);
        if (typeof input.roundId !== "string" || input.roundId !== s.roundId)
          throw fail(409, "題目已更新，請重新讀取。");
        if (s.status === "finished") throw fail(409, "派對已結束。");
        const m = member(s, p);
        if (["start", "reveal", "next", "finish"].includes(action)) host(s, p);
        if (action === "start") {
          if (!["lobby", "ready"].includes(s.status))
            throw fail(409, "這一題已開始。");
          if (!s.members.length) throw fail(409, "至少需要一位玩家加入。");
          s.status = "playing";
          s.startedAt = now();
          for (const m of s.members) {
            m.status = "guessing";
            m.feedback = "";
          }
        } else if (action === "guess" || action === "giveup") {
          if (!m) throw fail(403, "主持人不能參加搶答。");
          if (s.status !== "playing" || m.status !== "guessing")
            throw fail(409, "本題已完成或尚未開始。");
          if (action === "giveup") {
            m.status = "gaveup";
            m.feedback = "";
          } else {
            if (
              typeof input.answer !== "string" ||
              input.answer.length > 300 ||
              !norm(input.answer)
            )
              throw fail(400, "請輸入完整歌名。");
            const target = s.deck[s.cursor],
              selected = Number.isSafeInteger(input.songId)
                ? getPublishedSongs().find((song) => song.id === input.songId)
                : null;
            const correct = Number.isSafeInteger(input.songId)
              ? !!selected &&
                norm(selected.title) === norm(target.title) &&
                norm(selected.artist) === norm(target.artist)
              : norm(input.answer) === norm(target.title);
            if (correct) {
              m.status = "correct";
              m.place = ++s.correctCount;
              m.points = Math.max(100, 1100 - m.place * 100);
              m.score += m.points;
              m.correct++;
              m.orderTotal += m.place;
              m.feedback = "";
            } else {
              m.feedback = "還沒猜中，再試一次。";
              notifyOnly = p.id;
            }
          }
          if (s.members.every((m) => m.status !== "guessing")) settle(s);
        } else if (action === "reveal") {
          if (s.status !== "playing") throw fail(409, "請先開始播放這一題。");
          settle(s);
        } else if (action === "next") {
          if (s.status !== "revealed") throw fail(409, "請先揭曉這一題。");
          const previous = s.deck[s.cursor];
          s.round++;
          s.cursor++;
          if (s.cursor >= s.deck.length) {
            s.deck = shuffle(s.pool);
            if (s.deck.length > 1 && s.deck[0].id === previous.id)
              [s.deck[0], s.deck[1]] = [s.deck[1], s.deck[0]];
            s.cursor = 0;
          }
          s.roundId = newRoundId();
          s.correctCount = 0;
          s.status = "ready";
          for (const m of s.members) {
            m.status = "waiting";
            m.place = null;
            m.points = 0;
            m.feedback = "";
          }
        } else if (action === "finish") {
          if (s.status === "playing") settle(s);
          s.status = "finished";
          s.endedBy = { id: p.id, nickname: s.host.nickname };
        } else throw fail(404, "找不到派對操作。");
        s.revision++;
        return s;
      },
      () => notifyOnly,
    );
    return view(state, p);
  }
  function resultData(s, p) {
    access(s, p);
    if (s.status !== "finished") throw fail(409, "請先結束派對，再分享成績。");
    const me = member(s, p),
      isHost = s.host.id === p.id;
    const players = ranking(s).map((m, i) => ({
      rank: i + 1,
      nickname: m.nickname,
      score: m.score,
      correct: m.correct,
      played: m.played,
      isYou: m.id === p.id,
    }));
    return {
      type: "party",
      mode: "party",
      isHost,
      settings: { ...s.settings },
      nickname: isHost ? s.host.nickname : me.nickname,
      score: me?.score || 0,
      correct: me?.correct || 0,
      played: me?.played ?? s.completedRounds,
      totalRounds: s.completedRounds,
      roundScores: isHost
        ? []
        : s.history
            .filter((r) => r.playerId === p.id)
            .slice(-20)
            .map((r) => ({
              round: r.round,
              points: r.points,
              correct: r.correct,
            })),
      roundScoresTotal: me?.played ?? s.completedRounds,
      players,
      outcome: isHost
        ? "host"
        : players.findIndex((m) => m.isYou) === 0
          ? "win"
          : "played",
    };
  }
  function canSubscribe(id, p) {
    const s = read(id);
    access(s, p);
    if ((listeners.get(id)?.get(p.id)?.size || 0) >= 4)
      throw fail(429, "此玩家已開啟太多派對連線。");
    return view(s, p);
  }
  function subscribe(id, p, callback) {
    canSubscribe(id, p);
    const state = read(id),
      wasConnected = !!listeners.get(id)?.get(state.host.id)?.size;
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
    if (p.id === state.host.id && !wasConnected) emit(state);
    else callback(view(state, p));
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(callback);
      if (!set.size) room.delete(p.id);
      if (!room.size) listeners.delete(id);
      if (p.id === state.host.id && !room.has(p.id)) emit(read(id));
    };
  }
  return {
    create,
    join,
    mutate,
    resultData,
    canSubscribe,
    subscribe,
    get: (id, p) => view(read(id), p),
    close: () => listeners.clear(),
  };
}
