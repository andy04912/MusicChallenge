import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createGameService } from "../game-service.mjs";

test("large party catalog is stored once, legacy rooms migrate atomically and survive restart", () => {
  const db = new DatabaseSync(":memory:");
  const songs = Array.from({ length: 558 }, (_, i) => ({
    id: i + 1,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    region: "kr",
    year: "2020",
    category: "girl",
    preview: `https://audio.example/${i}/${"x".repeat(200)}`,
    artwork: "https://image.example/" + i,
    url: "https://music.example/" + i,
    album: "Album",
  }));
  let service = createGameService({ db, getPublishedSongs: () => songs });
  const host = service.player().player,
    a = service.player().player,
    b = service.player().player;
  let room = service.party.create(host);
  service.party.join(room.code, a);
  service.party.join(room.code, b);
  const mutate = (player, op, extra = {}) =>
    service.party.mutate(room.code, player, op, {
      roundId: room.roundId,
      ...extra,
    });
  room = mutate(host, "start");
  const target = songs.find((s) => s.preview === room.preview.preview);
  const stored = () =>
    JSON.parse(
      db.prepare("SELECT value FROM game_states WHERE id=?").get(room.code)
        .value,
    );
  let compact = stored();
  const catalog = db
    .prepare("SELECT value FROM party_catalogs WHERE id=?")
    .get(room.code).value;
  assert.equal(compact.pool, undefined);
  assert.ok(compact.deck.every(Number.isInteger));
  assert.ok(JSON.stringify(compact).length < catalog.length / 10);
  // Simulate an existing room written by the previous production version.
  const old = {
    ...compact,
    pool: songs,
    deck: compact.deck.map((id) => songs.find((s) => s.id === id)),
  };
  delete old.storageVersion;
  db.prepare("UPDATE game_states SET value=? WHERE id=?").run(
    JSON.stringify(old),
    room.code,
  );
  db.prepare("DELETE FROM party_catalogs WHERE id=?").run(room.code);
  service.close();
  service = createGameService({ db, getPublishedSongs: () => songs });
  assert.equal(
    service.party.get(room.code, host).preview.preview,
    target.preview,
  );
  // Failure after asset insert must roll back both catalog and score update.
  db.exec(
    "CREATE TRIGGER fail_party BEFORE INSERT ON game_states WHEN NEW.kind='party' BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END",
  );
  assert.throws(
    () => mutate(a, "guess", { answer: target.title, songId: target.id }),
    /simulated storage failure/,
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM party_catalogs").get().n,
    0,
  );
  assert.equal(service.party.get(room.code, a).me.score, 0);
  db.exec("DROP TRIGGER fail_party");
  mutate(a, "guess", { answer: target.title, songId: target.id });
  assert.equal(stored().storageVersion, 2);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM party_catalogs").get().n,
    1,
  );
  const assetBefore = db
    .prepare("SELECT value FROM party_catalogs")
    .get().value;
  mutate(b, "guess", {
    answer: "wrong",
    songId: songs.find((s) => s.id !== target.id).id,
  });
  assert.equal(
    db.prepare("SELECT value FROM party_catalogs").get().value,
    assetBefore,
  );
  service.close();
  service = createGameService({ db, getPublishedSongs: () => songs });
  const restored = service.party.get(room.code, a);
  assert.equal(restored.me.score, 1000);
  assert.equal(restored.me.place, 1);
  mutate(b, "giveup");
  assert.equal(service.party.get(room.code, b).answer.preview, undefined);
  service.close();
  db.close();
});
