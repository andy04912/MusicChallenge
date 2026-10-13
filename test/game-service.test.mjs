import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createGameService } from "../game-service.mjs";
const songs = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `Song ${i + 1}`,
  artist: `Artist ${i + 1}`,
  region: "kr",
  category: "girl",
  year: "2020",
  preview: `https://audio-ssl.itunes.apple.com/${i}.m4a`,
  url: `https://music.apple.com/tw/song/${i}`,
  artwork: "",
  album: "Album",
}));
function setup() {
  const db = new DatabaseSync(":memory:");
  const service = createGameService({ db, getPublishedSongs: () => songs });
  const a = service.player(),
    b = service.player();
  return { db, service, a: a.player, b: b.player, token: a.token };
}
const answerFor = (state) =>
  songs.find((song) => song.preview === state.preview.preview);
const change = (service, state, p, action, extra = {}) =>
  service.mutate(state.code || state.id, p, action, {
    revision: state.me?.revision ?? state.revision,
    ...extra,
  });

test("solo server scores independently, rejects duplicate requests, and ranks completed rounds only", () => {
  const { db, service, a } = setup();
  let run = service.create("run", a, { mode: "classic" });
  assert.equal(run.answer, null);
  assert.equal(run.totalRounds, 5);
  assert.throws(
    () =>
      change(service, run, a, "guess", {
        answer: answerFor(run).title,
        score: 999999,
      }),
    { status: 409 },
  );
  run = change(service, run, a, "play", { duration: 30 });
  const previous = run;
  run = change(service, run, a, "guess", {
    answer: answerFor(run).title,
    score: 999999,
  });
  assert.equal(run.score, 1000);
  assert.equal(run.answer.title, answerFor(run).title);
  assert.throws(
    () =>
      change(service, previous, a, "guess", {
        answer: answerFor(previous).title,
      }),
    { status: 409 },
  );
  assert.deepEqual(service.leaderboard().entries, []);
  run = change(service, run, a, "finish", { score: 999999 });
  assert.equal(service.leaderboard().entries[0].score, 1000);
  assert.equal(service.leaderboard().entries[0].played, 1);
  db.close();
});

test("wrong guesses unlock stages, replay does not unlock, final miss yields zero", () => {
  const { db, service, a } = setup();
  let run = service.create("run", a, {});
  run = change(service, run, a, "play");
  run = change(service, run, a, "play");
  assert.equal(run.points, 1000);
  for (const seconds of [6, 12, 18, 24, 30]) {
    run = change(service, run, a, "guess", { answer: "wrong" });
    assert.equal(run.clipSeconds, seconds);
    assert.equal(run.status, "playing");
  }
  run = change(service, run, a, "guess", { answer: "wrong" });
  assert.equal(run.status, "revealed");
  assert.equal(run.score, 0);
  assert.equal(run.lastResult.correct, false);
  db.close();
});

test("endless deck uses each unique song before recycling and avoids consecutive cycle repeats", () => {
  const { db, service, a } = setup();
  let run = service.create("run", a, { mode: "endless" }),
    seen = [];
  for (let i = 0; i < 7; i++) {
    seen.push(run.preview.preview);
    run = change(service, run, a, "reveal");
    run = change(service, run, a, "next");
  }
  assert.equal(new Set(seen.slice(0, 6)).size, 6);
  assert.notEqual(seen[5], seen[6]);
  assert.equal(run.round, 8);
  assert.equal(run.status, "playing");
  db.close();
});

test("rooms keep answer and score secret until both finish; both ready is required", () => {
  const { db, service, a, b } = setup();
  let host = service.create("room", a, {});
  assert.equal(host.status, "waiting");
  assert.equal(service.get(host.code, b).preview, null);
  let guest = service.join(host.code, b);
  host = service.get(host.code, a);
  assert.equal(host.preview.preview, guest.preview.preview);
  const c = service.player().player;
  assert.throws(() => service.join(host.code, c), { status: 409 });
  host = change(service, host, a, "play");
  const staleHost = host;
  host = change(service, host, a, "guess", { answer: answerFor(host).title });
  assert.equal(host.me.done, true);
  assert.equal(host.answer, null);
  assert.equal(host.results, null);
  assert.equal(host.me.score, 0);
  assert.throws(() => change(service, host, a, "ready"), { status: 409 });
  guest = service.get(host.code, b);
  guest = change(service, guest, b, "reveal");
  assert.equal(guest.status, "revealed");
  assert.deepEqual(
    guest.results.map((r) => r.points),
    [1000, 0],
  );
  assert.equal(guest.results[0].previousTotal, 0);
  assert.throws(
    () =>
      change(service, staleHost, a, "guess", {
        answer: answerFor(staleHost).title,
      }),
    { status: 409 },
  );
  host = service.get(host.code, a);
  host = change(service, host, a, "ready");
  assert.equal(host.round, 1);
  guest = service.get(host.code, b);
  guest = change(service, guest, b, "ready");
  assert.equal(guest.round, 2);
  assert.equal(guest.status, "playing");
  assert.equal(guest.answer, null);
  assert.equal(guest.me.stage, 0);
  db.close();
});

test("room SSE subscription reconnects from durable state and ignores opponent revision", () => {
  const { db, service, a, b, token } = setup();
  let host = service.create("room", a, {});
  service.join(host.code, b);
  host = service.get(host.code, a);
  let events = [];
  const unsubscribe = service.subscribe(host.code, a, (state) =>
    events.push(state),
  );
  assert.equal(events[0].players[0].connected, true);
  let guest = service.get(host.code, b);
  guest = change(service, guest, b, "play");
  host = change(service, host, a, "play");
  assert.equal(host.me.heard, true);
  unsubscribe();
  const recreated = createGameService({ db, getPublishedSongs: () => songs });
  assert.equal(recreated.player(token).player.id, a.id);
  assert.equal(recreated.get(host.code, a).me.heard, true);
  assert.equal(recreated.get(host.code, b).me.heard, true);
  assert.equal(recreated.get(host.code, a).players[0].connected, false);
  assert.throws(
    () =>
      recreated.mutate(host.code, recreated.player().player, "leave", {
        revision: 0,
      }),
    { status: 403 },
  );
  host = change(recreated, recreated.get(host.code, a), a, "leave");
  assert.equal(recreated.get(host.code, b).status, "finished");
  db.close();
});

test("short audio clamps stages, invalid inputs and forged identities are rejected", () => {
  const { db, service, a, b } = setup();
  assert.throws(() => service.create("run", a, { region: "other" }), {
    status: 400,
  });
  assert.throws(() => service.create("run", a, { region: "tw" }), {
    status: 400,
  });
  assert.throws(() => service.rename(a, "\n\u0000"), { status: 400 });
  let run = service.create("run", a, {});
  assert.throws(() => service.get(run.id, b), { status: 403 });
  run = change(service, run, a, "play", { duration: 4 });
  run = change(service, run, a, "guess", { answer: "wrong" });
  assert.equal(run.clipSeconds, 4);
  assert.equal(run.points, 800);
  run = change(service, run, a, "play", { duration: 90 });
  assert.equal(run.clipSeconds, 4);
  run = change(service, run, a, "guess", { answer: answerFor(run).title });
  assert.equal(run.score, 800);
  db.close();
});

test("long endless runs keep only recent history while score and ranking totals survive restart", () => {
  const { db, service, a } = setup();
  let run = service.create("run", a, { mode: "endless" });
  for (let index = 0; index < 61; index++) {
    run = change(service, run, a, "play");
    run = change(service, run, a, "guess", { answer: answerFor(run).title });
    if (index < 60) run = change(service, run, a, "next");
  }
  assert.equal(run.history.length, 50);
  assert.equal(run.played, 61);
  assert.equal(run.correct, 61);
  assert.equal(run.score, 61000);
  assert.equal(
    JSON.parse(
      db.prepare("SELECT value FROM game_states WHERE id=?").get(run.id).value,
    ).history.length,
    50,
  );
  const restored = createGameService({ db, getPublishedSongs: () => songs });
  run = restored.get(run.id, a);
  assert.equal(run.played, 61);
  change(restored, run, a, "finish");
  const entry = restored.leaderboard({ mode: "endless", region: "all" })
    .entries[0];
  assert.equal(entry.score, 61000);
  assert.equal(entry.played, 61);
  assert.equal(entry.correct, 61);
  db.close();
});

test("presence is shared across reconnecting tabs and duplicate ready cannot skip rounds", () => {
  const { db, service, a, b } = setup();
  let host = service.create("room", a, {});
  service.join(host.code, b);
  const stopA = service.subscribe(host.code, a, () => {});
  const stopB = service.subscribe(host.code, a, () => {});
  stopA();
  assert.equal(service.get(host.code, b).players[0].connected, true);
  stopB();
  assert.equal(service.get(host.code, b).players[0].connected, false);
  const stopNew = service.subscribe(host.code, a, () => {});
  stopB(); // A delayed duplicate close must not remove the new connection.
  assert.equal(service.get(host.code, b).players[0].connected, true);
  host = change(service, service.get(host.code, a), a, "play");
  host = change(service, host, a, "guess", { answer: answerFor(host).title });
  let guest = service.get(host.code, b);
  assert.deepEqual(
    guest.players.map((player) => player.score),
    [0, 0],
  );
  assert.equal(guest.results, null);
  guest = change(service, guest, b, "reveal");
  host = change(service, service.get(host.code, a), a, "ready");
  assert.throws(() => change(service, host, a, "ready"), { status: 409 });
  assert.equal(service.get(host.code, b).round, 1);
  guest = change(service, service.get(host.code, b), b, "ready");
  assert.equal(guest.round, 2);
  assert.equal(guest.players[0].score, 1000);
  stopNew();
  db.close();
});

test("confirmed room leave broadcasts the initiator and persists a final settlement", () => {
  const { db, service, a, b } = setup();
  const room = service.create("room", a, { mode: "classic" });
  service.join(room.code, b);
  const events = [];
  const stop = service.subscribe(room.code, b, (state) => events.push(state));
  const active = service.get(room.code, a);
  const closed = change(service, active, a, "leave");
  assert.equal(closed.status, "finished");
  assert.deepEqual(closed.endedBy, { id: a.id, nickname: a.nickname });
  assert.equal(events.at(-1).status, "finished");
  assert.deepEqual(events.at(-1).endedBy, closed.endedBy);
  assert.equal(events.at(-1).answer, null);
  assert.throws(() => change(service, service.get(room.code, b), b, "play"), {
    status: 409,
  });
  stop();
  service.close();
  const reopened = createGameService({ db, getPublishedSongs: () => songs });
  assert.deepEqual(reopened.get(room.code, b).endedBy, closed.endedBy);
  reopened.close();
  db.close();
});

test("public solo receipts are owner-only, immutable, sanitized and restored after restart", () => {
  const { db, service, a, b } = setup();
  let run = service.create("run", a, { mode: "endless" });
  assert.throws(
    () => service.createResult(a, { sessionId: "missing_valid_id" }),
    { status: 404 },
  );
  assert.throws(() => service.createResult(a, { sessionId: run.id }), {
    status: 409,
  });
  assert.throws(() => service.createResult(b, { sessionId: run.id }), {
    status: 403,
  });
  for (let i = 0; i < 25; i++) {
    run = change(service, run, a, "play");
    run = change(service, run, a, "guess", { answer: answerFor(run).title });
    if (i < 24) run = change(service, run, a, "next");
  }
  run = change(service, run, a, "finish");
  const receipt = service.createResult(a, {
    sessionId: run.id,
    score: 999999,
    nickname: "forged",
    correct: 900,
  });
  assert.match(receipt.id, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(receipt.score, 25000);
  assert.equal(receipt.correct, 25);
  assert.equal(receipt.played, 25);
  assert.equal(receipt.nickname, a.nickname);
  assert.equal(receipt.type, "solo");
  assert.equal(receipt.outcome, "solo");
  assert.equal(receipt.roundScores.length, 20);
  assert.equal(receipt.roundScores[0].round, 6);
  assert.equal(receipt.roundScoresTotal, 25);
  assert.deepEqual(
    Object.keys(receipt).sort(),
    [
      "id",
      "createdAt",
      "type",
      "mode",
      "settings",
      "nickname",
      "score",
      "correct",
      "played",
      "totalRounds",
      "roundScores",
      "roundScoresTotal",
      "players",
      "outcome",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(receipt.roundScores[0]).sort(),
    ["round", "points", "correct"].sort(),
  );
  assert.deepEqual(
    Object.keys(receipt.players[0]).sort(),
    ["nickname", "score", "correct", "played", "isYou"].sort(),
  );
  const publicText = JSON.stringify(receipt);
  for (const secret of [
    a.id,
    b.id,
    run.id,
    songs[0].title,
    songs[0].preview,
    songs[0].artist,
  ])
    assert.ok(!publicText.includes(secret));
  service.rename(a, "new nickname");
  // Immutable receipt survives even if the private game's stored score changes later.
  const row = JSON.parse(
    db.prepare("SELECT value FROM game_states WHERE id=?").get(run.id).value,
  );
  row.members[0].score = 1;
  db.prepare("UPDATE game_states SET value=? WHERE id=?").run(
    JSON.stringify(row),
    run.id,
  );
  assert.deepEqual(service.createResult(a, { sessionId: run.id }), receipt);
  const restored = createGameService({ db, getPublishedSongs: () => songs });
  assert.deepEqual(restored.result(receipt.id), receipt);
  assert.deepEqual(restored.createResult(a, { sessionId: run.id }), receipt);
  assert.throws(() => restored.result("not-a-real-result"), { status: 404 });
  db.close();
});

test("duel receipts preserve each member perspective and reject unfinished reveals", () => {
  const { db, service, a, b } = setup();
  let host = service.create("room", a, { mode: "endless" });
  service.join(host.code, b);
  host = change(service, service.get(host.code, a), a, "play");
  host = change(service, host, a, "guess", { answer: answerFor(host).title });
  let guest = change(service, service.get(host.code, b), b, "reveal");
  assert.throws(() => service.createResult(a, { sessionId: host.code }), {
    status: 409,
  });
  guest = change(service, guest, b, "finish");
  const winner = service.createResult(a, { sessionId: host.code });
  const loser = service.createResult(b, { sessionId: host.code });
  assert.notEqual(winner.id, loser.id);
  assert.equal(winner.type, "duel");
  assert.equal(winner.outcome, "win");
  assert.equal(loser.outcome, "loss");
  assert.equal(winner.score, 1000);
  assert.equal(loser.score, 0);
  assert.deepEqual(
    winner.players.map((p) => [p.score, p.correct, p.played, p.isYou]),
    [
      [1000, 1, 1, true],
      [0, 0, 1, false],
    ],
  );
  assert.deepEqual(
    loser.players.map((p) => p.isYou),
    [false, true],
  );
  assert.deepEqual(winner.roundScores, [
    { round: 1, points: 1000, correct: true },
  ]);
  assert.deepEqual(loser.roundScores, [
    { round: 1, points: 0, correct: false },
  ]);
  db.close();
});

test("ending mid-round banks completed answers, freezes unfinished side and conceals the song", () => {
  const { db, service, a, b } = setup();
  const room = service.create("room", a, { mode: "classic" });
  service.join(room.code, b);
  let host = change(service, service.get(room.code, a), a, "play");
  host = change(service, host, a, "guess", { answer: answerFor(host).title });
  assert.equal(host.me.score, 0);
  const staleGuest = service.get(room.code, b);
  const ended = change(service, staleGuest, b, "finish");
  assert.equal(ended.status, "finished");
  assert.deepEqual(ended.endedBy, { id: b.id, nickname: b.nickname });
  assert.equal(ended.answer, null);
  assert.equal(ended.preview, null);
  assert.deepEqual(
    ended.players.map((p) => [p.score, p.correct, p.played]),
    [
      [1000, 1, 1],
      [0, 0, 1],
    ],
  );
  assert.deepEqual(
    ended.results.map((p) => [p.points, p.total, p.previousTotal]),
    [
      [1000, 1000, 0],
      [0, 0, 0],
    ],
  );
  assert.throws(
    () =>
      change(service, staleGuest, b, "guess", {
        answer: answerFor(host).title,
      }),
    { status: 409 },
  );
  assert.throws(() => change(service, ended, b, "finish"), { status: 409 });
  assert.equal(service.createResult(a, { sessionId: room.code }).score, 1000);
  assert.equal(
    service.createResult(b, { sessionId: room.code }).outcome,
    "loss",
  );
  const restarted = createGameService({ db, getPublishedSongs: () => songs });
  assert.deepEqual(restarted.get(room.code, a).endedBy, ended.endedBy);
  assert.equal(restarted.get(room.code, a).me.correct, 1);
  assert.equal(restarted.leaderboard().entries[0].score, 1000);
  db.close();
});

test("ending waiting rooms or untouched rounds produces zero settlement without fake answers", () => {
  const { db, service, a, b } = setup();
  for (const joined of [false, true]) {
    const room = service.create("room", a, { mode: "endless" });
    if (joined) service.join(room.code, b);
    const ended = change(service, service.get(room.code, a), a, "finish");
    assert.equal(ended.status, "finished");
    assert.equal(ended.answer, null);
    assert.equal(ended.preview, null);
    assert.ok(
      ended.players.every(
        (p) => p.score === 0 && p.played === 0 && p.correct === 0,
      ),
    );
    assert.ok(
      ended.results.every((p) => p.points === 0 && p.previousTotal === 0),
    );
    const receipt = service.createResult(a, { sessionId: room.code });
    assert.equal(receipt.outcome, "draw");
    assert.equal(receipt.played, 0);
    assert.deepEqual(receipt.roundScores, []);
  }
  db.close();
});

test("ending revealed or partially ready rounds never awards their points twice", () => {
  const { db, service, a, b } = setup();
  for (const ready of [false, true]) {
    const room = service.create("room", a, { mode: "endless" });
    service.join(room.code, b);
    let host = change(service, service.get(room.code, a), a, "play");
    host = change(service, host, a, "guess", { answer: answerFor(host).title });
    change(service, service.get(room.code, b), b, "reveal");
    if (ready) change(service, service.get(room.code, a), a, "ready");
    const ended = change(service, service.get(room.code, b), b, "leave");
    assert.equal(ended.status, "finished");
    assert.deepEqual(
      ended.players.map((p) => [p.score, p.played]),
      [
        [1000, 1],
        [0, 1],
      ],
    );
    assert.ok(ended.players.every((p) => !p.ready));
    assert.equal(
      service.createResult(a, { sessionId: room.code }).roundScores.length,
      1,
    );
  }
  db.close();
});

test("legacy closed rooms recover final summaries without awarding formerly pending points", () => {
  const { db, service, a, b } = setup();
  const room = service.create("room", a, {});
  service.join(room.code, b);
  let host = change(service, service.get(room.code, a), a, "play");
  host = change(service, host, a, "guess", { answer: answerFor(host).title });
  const old = JSON.parse(
    db.prepare("SELECT value FROM game_states WHERE id=?").get(room.code).value,
  );
  old.status = "closed";
  old.closedBy = { id: b.id, nickname: b.nickname };
  db.prepare("UPDATE game_states SET value=? WHERE id=?").run(
    JSON.stringify(old),
    room.code,
  );
  const restored = createGameService({ db, getPublishedSongs: () => songs });
  const ended = restored.get(room.code, a);
  assert.equal(ended.status, "finished");
  assert.deepEqual(ended.endedBy, old.closedBy);
  assert.equal(ended.me.score, 0);
  assert.equal(ended.me.lastResult, null);
  assert.ok(ended.results.every((p) => p.points === 0));
  assert.equal(restored.createResult(a, { sessionId: room.code }).score, 0);
  db.close();
});

test("ending an untouched next round preserves previous totals without revealing the new song", () => {
  const { db, service, a, b } = setup();
  const room = service.create("room", a, { mode: "endless" });
  service.join(room.code, b);
  let host = change(service, service.get(room.code, a), a, "play");
  host = change(service, host, a, "guess", { answer: answerFor(host).title });
  change(service, service.get(room.code, b), b, "reveal");
  change(service, service.get(room.code, a), a, "ready");
  change(service, service.get(room.code, b), b, "ready");
  const ended = change(service, service.get(room.code, a), a, "finish");
  assert.equal(ended.round, 2);
  assert.equal(ended.me.score, 1000);
  assert.equal(ended.me.played, 1);
  assert.equal(ended.answer, null);
  assert.equal(ended.me.lastResult, null);
  assert.deepEqual(
    ended.results.map((p) => [p.points, p.total, p.previousTotal]),
    [
      [0, 1000, 1000],
      [0, 0, 0],
    ],
  );
  assert.deepEqual(
    service.createResult(a, { sessionId: room.code }).roundScores,
    [{ round: 1, points: 1000, correct: true }],
  );
  db.close();
});
