import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createGameService, partyJoinOrigins } from "../game-service.mjs";
const songs = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1,
  title: `Party Song ${i + 1}`,
  artist: "Party Artist",
  region: "kr",
  category: "girl",
  year: "2020",
  preview: `https://audio-ssl.itunes.apple.com/party-${i}.m4a`,
  url: `https://music.apple.com/tw/song/${i}`,
  artwork: "",
  album: "Album",
}));
function setup(count = 2) {
  const db = new DatabaseSync(":memory:");
  const game = createGameService({ db, getPublishedSongs: () => songs });
  const host = game.player().player,
    players = Array.from({ length: count }, () => game.player().player);
  return { db, game, party: game.party, host, players };
}
const action = (party, room, p, name, input = {}) =>
  party.mutate(room.code, p, name, { roundId: room.roundId, ...input });
const answer = (room) =>
  songs.find((song) => song.preview === room.preview.preview).title;

test("party roles hide host audio and reject stale actions, wrong guesses retry without changing other clients", () => {
  const {
    db,
    game,
    party,
    host,
    players: [a, b],
  } = setup();
  let room = party.create(host, {});
  assert.equal(room.status, "lobby");
  assert.equal(party.get(room.code, { id: "outside" }).preview, null);
  assert.equal(party.get(room.code, { id: "outside" }).hostId, null);
  assert.deepEqual(party.get(room.code, { id: "outside" }).players, []);
  assert.throws(() => action(party, room, host, "start"), { status: 409 });
  party.join(room.code, a);
  party.join(room.code, b);
  assert.throws(() => action(party, room, a, "start"), { status: 403 });
  assert.throws(() => game.get(room.code, a), { status: 404 });
  assert.throws(() => game.mutate(room.code, a, "play", { revision: 2 }), {
    status: 404,
  });
  room = action(party, room, host, "start");
  assert.equal(room.status, "playing");
  assert.throws(
    () => action(party, room, host, "guess", { answer: answer(room) }),
    { status: 403 },
  );
  assert.throws(() => party.join(room.code, { id: "late", nickname: "Late" }), {
    status: 409,
  });
  assert.equal(party.join(room.code, a).me.status, "guessing");
  assert.throws(
    () =>
      action(party, { ...room, roundId: "stale" }, a, "guess", {
        answer: answer(room),
      }),
    { status: 409 },
  );
  const hostEvents = [],
    aEvents = [],
    bEvents = [];
  const stops = [
    party.subscribe(room.code, host, (x) => hostEvents.push(x)),
    party.subscribe(room.code, a, (x) => aEvents.push(x)),
    party.subscribe(room.code, b, (x) => bEvents.push(x)),
  ];
  const counts = [hostEvents.length, aEvents.length, bEvents.length];
  const wrong = action(party, room, a, "guess", { answer: "incorrect" });
  assert.equal(wrong.me.status, "guessing");
  assert.ok(wrong.me.feedback);
  assert.equal(hostEvents.length, counts[0]);
  assert.equal(aEvents.length, counts[1] + 1);
  assert.equal(bEvents.length, counts[2]);
  const correct = action(party, room, a, "guess", {
    answer: answer(room),
    score: 999999,
  });
  assert.equal(correct.me.points, 1000);
  assert.equal(correct.me.place, 1);
  assert.throws(
    () => action(party, room, a, "guess", { answer: answer(room) }),
    { status: 409 },
  );
  const revealed = action(party, room, b, "giveup");
  assert.equal(revealed.status, "revealed");
  assert.ok(revealed.answer.title);
  assert.equal(revealed.answer.preview, undefined);
  assert.ok(!JSON.stringify(revealed).includes(room.preview.preview));
  assert.equal(party.get(room.code, host).answer.preview, room.preview.preview);
  for (const stop of stops) stop();
  db.close();
});

test("50-player capacity excludes host; correct arrival order and floor-point ranking remain deterministic", () => {
  const { db, party, host, players } = setup(51);
  let room = party.create(host, {});
  party.join(room.code, host);
  assert.equal(party.get(room.code, host).playerCount, 0);
  for (const player of players.slice(0, 50)) party.join(room.code, player);
  assert.equal(party.get(room.code, host).playerCount, 50);
  assert.throws(() => party.join(room.code, players[50]), { status: 409 });
  const before = party.get(room.code, players[0]);
  assert.equal(party.join(room.code, players[0]).revision, before.revision);
  room = action(party, room, host, "start");
  const order = players.slice(0, 50).reverse();
  for (const player of order)
    action(party, room, player, "guess", { answer: answer(room) });
  const result = party.get(room.code, host);
  assert.equal(result.status, "revealed");
  assert.deepEqual(
    result.players.map((p) => p.id),
    order.map((p) => p.id),
  );
  assert.deepEqual(
    result.players.map((p) => p.place),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    result.players.map((p) => p.rank),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  assert.equal(result.players[0].score, 1000);
  assert.equal(result.players[9].score, 100);
  assert.equal(result.players[49].score, 100);
  assert.ok(result.players.every((p) => p.correct === 1 && p.played === 1));
  db.close();
});

test("party decks do not repeat before exhaustion, host finish freezes points and receipt persists without private fields", () => {
  const {
    db,
    game,
    party,
    host,
    players: [a, b],
  } = setup();
  let room = party.create(host, {});
  party.join(room.code, a);
  party.join(room.code, b);
  const heard = [];
  for (let i = 0; i < 5; i++) {
    heard.push(room.preview.preview);
    room = action(party, room, host, "start");
    action(party, room, a, "guess", { answer: answer(room) });
    if (i < 4) {
      room = action(party, room, host, "reveal");
      room = action(party, room, host, "next");
      assert.equal(room.status, "ready");
    } else room = action(party, room, host, "finish");
  }
  assert.equal(new Set(heard.slice(0, 4)).size, 4);
  assert.notEqual(heard[3], heard[4]);
  assert.equal(room.status, "finished");
  assert.equal(room.answer, null);
  assert.equal(room.preview, null);
  assert.equal(room.players[0].score, 5000);
  assert.equal(room.players[0].played, 5);
  assert.equal(room.players[1].score, 0);
  assert.equal(room.players[1].played, 5);
  assert.deepEqual(game.leaderboard().entries, []);
  const receipt = game.createResult(host, {
    sessionId: room.code,
    score: 9999,
  });
  assert.equal(receipt.type, "party");
  assert.equal(receipt.mode, "party");
  assert.equal(receipt.isHost, true);
  assert.equal(receipt.outcome, "host");
  assert.equal(receipt.score, 0);
  assert.equal(receipt.totalRounds, 5);
  assert.ok(receipt.players.every((p) => p.isYou === false));
  assert.equal(receipt.players[0].score, 5000);
  const playerReceipt = game.createResult(a, { sessionId: room.code });
  assert.equal(playerReceipt.outcome, "win");
  assert.equal(playerReceipt.score, 5000);
  assert.equal(playerReceipt.roundScores.length, 5);
  for (const value of [
    room.code,
    host.id,
    a.id,
    b.id,
    ...heard,
    songs[0].title,
  ])
    assert.ok(!JSON.stringify(receipt).includes(value));
  assert.throws(
    () => game.createResult({ id: "outside" }, { sessionId: room.code }),
    { status: 403 },
  );
  const restarted = createGameService({ db, getPublishedSongs: () => songs });
  assert.equal(restarted.party.get(room.code, host).hostConnected, false);
  assert.equal(restarted.party.get(room.code, a).me.score, 5000);
  assert.deepEqual(restarted.result(receipt.id), receipt);
  assert.deepEqual(
    restarted.createResult(host, { sessionId: room.code }),
    receipt,
  );
  db.close();
});

test("host presence reconnects without gameplay revision changes and each seat caps SSE connections", () => {
  const {
    db,
    party,
    host,
    players: [a],
  } = setup();
  const room = party.create(host, {});
  party.join(room.code, a);
  const events = [];
  const stopMember = party.subscribe(room.code, a, (x) => events.push(x));
  assert.equal(events.at(-1).hostConnected, false);
  const revision = events.at(-1).revision;
  const stops = Array.from({ length: 4 }, () =>
    party.subscribe(room.code, host, () => {}),
  );
  assert.equal(events.at(-1).hostConnected, true);
  assert.equal(events.at(-1).revision, revision);
  assert.throws(() => party.subscribe(room.code, host, () => {}), {
    status: 429,
  });
  for (const stop of stops) stop();
  assert.equal(events.at(-1).hostConnected, false);
  const stopAgain = party.subscribe(room.code, host, () => {});
  stops[0]();
  assert.equal(events.at(-1).hostConnected, true);
  stopAgain();
  stopMember();
  db.close();
});

test("LAN join origins only reveal private addresses to local requests without a fixed origin", () => {
  const req = {
    headers: { host: "127.0.0.1:8080" },
    socket: { localPort: 8080 },
  };
  const interfaces = {
    a: [
      { family: "IPv4", address: "192.168.1.5", internal: false },
      { family: "IPv4", address: "10.1.2.3", internal: false },
      { family: "IPv4", address: "172.16.0.2", internal: false },
      { family: "IPv4", address: "169.254.1.2", internal: false },
      { family: "IPv4", address: "8.8.8.8", internal: false },
      { family: "IPv4", address: "127.0.0.1", internal: true },
    ],
  };
  assert.deepEqual(
    partyJoinOrigins(req, { interfaces, configuredOrigin: "" }),
    [
      "http://192.168.1.5:8080",
      "http://10.1.2.3:8080",
      "http://172.16.0.2:8080",
    ],
  );
  assert.deepEqual(partyJoinOrigins(req, { interfaces, production: true }), []);
  assert.deepEqual(
    partyJoinOrigins(req, {
      interfaces,
      configuredOrigin: "http://127.0.0.1:8080",
    }),
    [],
  );
  assert.deepEqual(
    partyJoinOrigins({ headers: { host: "public.test:8080" } }, { interfaces }),
    [],
  );
});
