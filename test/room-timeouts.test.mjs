import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { once } from "node:events";
import { createGameService, createGameplayHandler } from "../game-service.mjs";

const songs = [
  {
    id: 1,
    title: "Song",
    artist: "Singer",
    year: "2024",
    region: "kr",
    category: "girl",
    preview: "https://audio-ssl.itunes.apple.com/test.m4a",
    url: "https://music.apple.com/tw/song/1",
  },
];
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  let clock = 1_000;
  const options = { db, getPublishedSongs: () => songs, now: () => clock };
  let service = createGameService(options);
  const a = service.player().player,
    b = service.player().player;
  t.after(() => {
    service.close();
    db.close();
  });
  return {
    db,
    a,
    b,
    get service() {
      return service;
    },
    advance(ms) {
      clock += ms;
    },
    restart() {
      service.close();
      service = createGameService(options);
    },
  };
}
const change = (service, id, p, action, body = {}) =>
  service.mutate(id, p, action, {
    revision: service.get(id, p).me.revision,
    ...body,
  });

test("idle duel expires despite live sockets/reads, banks the completed answer once and keeps a shareable result", (t) => {
  const f = fixture(t),
    { service, a, b } = f;
  const room = service.create("room", a, {});
  service.join(room.code, b);
  const events = [];
  service.subscribe(room.code, a, (x) => events.push(x));
  service.subscribe(room.code, b, () => {});
  change(service, room.code, a, "play");
  change(service, room.code, a, "guess", { answer: "Song" });
  f.advance(599_999);
  assert.equal(service.get(room.code, a).status, "playing");
  f.advance(1);
  service.sweep();
  const done = service.get(room.code, a);
  assert.equal(done.endReason, "idle");
  assert.equal(done.status, "finished");
  assert.equal(done.me.score, 1000);
  assert.equal(done.answer, null);
  assert.equal(events.at(-1).status, "finished");
  service.sweep();
  assert.equal(service.get(room.code, a).me.score, 1000);
  assert.throws(() => change(service, room.code, a, "ready"), { status: 409 });
  assert.equal(service.createResult(a, { sessionId: room.code }).score, 1000);
});

test("only successful gameplay refreshes the idle deadline", (t) => {
  const f = fixture(t),
    { service, a, b } = f;
  const room = service.create("room", a, {});
  service.join(room.code, b);
  service.subscribe(room.code, a, () => {});
  service.subscribe(room.code, b, () => {});
  f.advance(590_000);
  change(service, room.code, a, "play");
  f.advance(590_000);
  assert.throws(() => service.mutate(room.code, a, "guess", { revision: -1 }), {
    status: 409,
  });
  assert.equal(service.get(room.code, a).status, "playing");
  f.advance(10_000);
  assert.equal(service.get(room.code, a).endReason, "idle");
});

test("duel disconnect grace accounts for multiple tabs and resets only on reconnection", (t) => {
  const f = fixture(t),
    { service, a, b } = f;
  const room = service.create("room", a, {});
  service.join(room.code, b);
  const stopA = service.subscribe(room.code, a, () => {});
  const stopA2 = service.subscribe(room.code, a, () => {});
  service.subscribe(room.code, b, () => {});
  stopA();
  f.advance(120_001);
  assert.equal(service.get(room.code, b).status, "playing");
  stopA2();
  f.advance(119_000);
  const stopAgain = service.subscribe(room.code, a, () => {});
  f.advance(2_000);
  assert.equal(service.get(room.code, b).status, "playing");
  stopAgain();
  f.advance(120_000);
  service.sweep();
  assert.equal(service.get(room.code, b).endReason, "disconnected");
  assert.equal(service.get(room.code, b).me.played, 0);
});

test("a departed party host expires even while players keep submitting; earned points remain", (t) => {
  const f = fixture(t),
    { service, a, b } = f,
    party = service.party;
  const room = party.create(a);
  const c = service.player().player;
  party.join(room.code, b);
  party.join(room.code, c);
  const events = [];
  const stopHost = party.subscribe(room.code, a, () => {});
  party.subscribe(room.code, b, (x) => events.push(x));
  party.subscribe(room.code, c, () => {});
  const act = (p, name, extra = {}) =>
    party.mutate(room.code, p, name, { roundId: room.roundId, ...extra });
  act(a, "start");
  act(b, "guess", { answer: "Song" });
  stopHost();
  f.advance(110_000);
  act(c, "guess", { answer: "Wrong" });
  f.advance(10_000);
  service.sweep();
  assert.equal(events.at(-1).status, "finished");
  const result = party.get(room.code, b);
  assert.equal(result.endReason, "disconnected");
  assert.equal(result.me.score, 1000);
  assert.equal(result.me.played, 1);
  service.sweep();
  assert.equal(party.get(room.code, b).me.played, 1);
  assert.equal(service.createResult(b, { sessionId: room.code }).score, 1000);
});

test("connected party host may wait for players, but idle lobby closes with zero completed rounds", (t) => {
  const f = fixture(t),
    party = f.service.party;
  const room = party.create(f.a);
  party.join(room.code, f.b);
  party.subscribe(room.code, f.a, () => {});
  f.advance(120_001);
  assert.equal(party.get(room.code, f.a).status, "lobby");
  f.advance(480_000);
  f.service.sweep();
  assert.equal(party.get(room.code, f.a).endReason, "idle");
  assert.equal(party.get(room.code, f.a).completedRounds, 0);
});

test("restart preserves activity deadline for existing and legacy rooms", (t) => {
  const f = fixture(t);
  const room = f.service.create("room", f.a, {});
  const party = f.service.party.create(f.a);
  // The previous release has no lastActivityAt; use its persisted updatedAt.
  f.db
    .prepare(
      "UPDATE game_states SET value=json_remove(value,'$.lastActivityAt') WHERE id=?",
    )
    .run(party.code);
  f.advance(600_001);
  f.restart();
  f.service.sweep();
  assert.equal(f.service.get(room.code, f.a).endReason, "idle");
  assert.equal(f.service.party.get(party.code, f.a).endReason, "idle");
});

test("SSE cancellation releases presence, subsequent room requests work and terminal streams really end", async (t) => {
  const db = new DatabaseSync(":memory:");
  let clock = 1000;
  const json = (res, status, value) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const handler = createGameplayHandler({
    db,
    getPublishedSongs: () => songs,
    now: () => clock,
    body: async () => ({}),
    json,
    sameOrigin: () => {},
    production: false,
  });
  const server = createServer((req, res) => {
    handler
      .handle(req, res, new URL(req.url, "http://localhost"))
      .catch((e) => json(res, e.status || 500, { error: e.message }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    handler.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { player, token } = handler.service.player();
  const headers = { Cookie: `music_player=${token}` };
  for (let i = 0; i < 3; i++) {
    const party = handler.service.party.create(player);
    const response = await fetch(`${base}/api/parties/${party.code}/events`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    for (
      let j = 0;
      j < 50 && handler.service.party.get(party.code, player).hostConnected;
      j++
    )
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(
      handler.service.party.get(party.code, player).hostConnected,
      false,
    );
    const duel = handler.service.create("room", player, {});
    const next = await fetch(`${base}/api/rooms/${duel.code}`, {
      headers,
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(next.status, 200);
  }
  for (const mode of ["rooms", "parties"]) {
    const room =
      mode === "rooms"
        ? handler.service.create("room", player, {})
        : handler.service.party.create(player);
    const response = await fetch(`${base}/api/${mode}/${room.code}/events`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    const reader = response.body.getReader();
    let data = new TextDecoder().decode((await reader.read()).value);
    clock += 600_001;
    handler.service.sweep();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      data += new TextDecoder().decode(chunk.value);
    }
    assert.match(data, /"endReason":"idle"/);
    assert.match(data, /event: closed/);
    const retry = await fetch(`${base}/api/${mode}/${room.code}/events`, {
      headers,
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(retry.status, 204);
  }
});
