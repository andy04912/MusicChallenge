import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test(
  "50 independent HTTP players receive role-safe SSE, ordered scores, and persisted public party results",
  { timeout: 30000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "music-party-api-"));
    let child, origin;
    const streams = [];
    async function boot() {
      child = spawn(process.execPath, ["server.mjs"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          DATA_DIR: dir,
          NODE_ENV: "test",
          APP_ORIGIN: "",
          SERVE_STATIC: "false",
          ADMIN_PASSWORD: "party-api-integration-only",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      origin = await new Promise((yes, no) => {
        let out = "",
          err = "";
        const timer = setTimeout(() => no(new Error("startup timeout")), 10000);
        child.stderr.on("data", (x) => (err += x));
        child.stdout.on("data", (x) => {
          out += x;
          const found = out.match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);
          if (found) {
            clearTimeout(timer);
            yes(found[1]);
          }
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          no(new Error(`${code}: ${err}`));
        });
      });
    }
    async function stop() {
      if (child?.exitCode === null) {
        const end = once(child, "exit");
        child.kill();
        await end;
      }
    }
    t.after(async () => {
      for (const stream of streams) stream.abort.abort();
      await Promise.all(streams.map((s) => s.pump));
      await stop();
      assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
      await rm(dir, { recursive: true, force: true });
    });
    const request = (path, cookie, method = "GET", input) =>
      fetch(origin + path, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
    const guest = async () => {
      const response = await request("/api/player");
      return {
        cookie: response.headers.get("set-cookie").split(";")[0],
        player: await response.json(),
      };
    };
    await boot();
    const db = new DatabaseSync(join(dir, "songs.sqlite"));
    db.exec("UPDATE songs SET status='published',categoryReview=0");
    db.close();
    const host = await guest(),
      players = await Promise.all(Array.from({ length: 51 }, guest));
    let room = await (
      await request("/api/parties", host.cookie, "POST", { region: "kr" })
    ).json();
    assert.match(room.code, /^P[A-Za-z0-9_-]{15}$/);
    const publicRoom = await request(`/api/parties/${room.code}`);
    assert.equal(publicRoom.headers.get("set-cookie"), null);
    assert.equal((await publicRoom.json()).preview, null);
    assert.equal(
      (await request(`/api/parties/${room.code}/join`, undefined, "POST", {}))
        .status,
      401,
    );
    const joined = await Promise.all(
      players
        .slice(0, 50)
        .map((p) =>
          request(`/api/parties/${room.code}/join`, p.cookie, "POST", {}),
        ),
    );
    assert.ok(joined.every((r) => r.status === 200));
    assert.equal(
      (
        await request(
          `/api/parties/${room.code}/join`,
          players[50].cookie,
          "POST",
          {},
        )
      ).status,
      409,
    );
    assert.equal(
      (await request(`/api/parties/${room.code}/events`, players[50].cookie))
        .status,
      403,
    );
    assert.equal(
      (await request(`/api/runs/${room.code}`, players[0].cookie)).status,
      404,
    );
    assert.equal(
      (await request(`/api/rooms/${room.code}`, players[0].cookie)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/parties/${room.code}/start`,
          players[0].cookie,
          "POST",
          { roundId: room.roundId },
        )
      ).status,
      403,
    );
    room = await (
      await request(`/api/parties/${room.code}/start`, host.cookie, "POST", {
        roundId: room.roundId,
      })
    ).json();
    assert.equal(room.status, "playing");
    const catalog = await (await request("/api/catalog")).json();
    assert.ok(
      catalog.every((song) => !("preview" in song) && !("artwork" in song)),
    );
    const fixtures = JSON.parse(
      await readFile(new URL("../seeds/catalog.json", import.meta.url), "utf8"),
    );
    const target = fixtures.find(
      (song) => song.preview === room.preview.preview,
    );
    assert.ok(target);
    await Promise.all(
      players.slice(0, 50).map(async (p) => {
        const abort = new AbortController(),
          response = await fetch(origin + `/api/parties/${room.code}/events`, {
            headers: { Cookie: p.cookie },
            signal: abort.signal,
          });
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-type"),
          /text\/event-stream/,
        );
        const stream = {
          abort,
          latest: null,
          count: 0,
          pump: null,
          error: null,
        };
        streams.push(stream);
        const reader = response.body.getReader();
        stream.pump = (async () => {
          let pending = "";
          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              pending += decoder.decode(value, { stream: true });
              let boundary;
              while ((boundary = pending.indexOf("\n\n")) >= 0) {
                const frame = pending.slice(0, boundary);
                pending = pending.slice(boundary + 2);
                const data = frame
                  .split("\n")
                  .find((line) => line.startsWith("data: "));
                if (!data) continue;
                const snapshot = JSON.parse(data.slice(6));
                assert.equal(snapshot.preview, null);
                assert.ok(!JSON.stringify(snapshot).includes(target.preview));
                assert.ok(
                  !stream.latest || snapshot.revision >= stream.latest.revision,
                );
                stream.latest = snapshot;
                stream.count++;
              }
            }
          } catch (error) {
            if (error.name !== "AbortError") stream.error = error;
          }
        })();
      }),
    );
    const responses = await Promise.all(
      players.slice(0, 50).map((p) =>
        request(`/api/parties/${room.code}/guess`, p.cookie, "POST", {
          roundId: room.roundId,
          answer: target.title,
          score: 999999,
        }),
      ),
    );
    assert.ok(responses.every((r) => r.status === 200));
    const guesses = await Promise.all(responses.map((r) => r.json()));
    assert.equal(new Set(guesses.map((s) => s.me.place)).size, 50);
    assert.ok(
      guesses.every(
        (s) => s.me.points === Math.max(100, 1100 - s.me.place * 100),
      ),
    );
    const deadline = Date.now() + 8000;
    while (
      streams.some((s) => s.latest?.status !== "revealed") &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(streams.every((s) => s.latest?.status === "revealed"));
    assert.ok(streams.every((s) => !s.error));
    assert.ok(streams.every((s) => s.count >= 2));
    room = await (
      await request(`/api/parties/${room.code}`, host.cookie)
    ).json();
    assert.deepEqual(
      room.players.map((p) => p.place),
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    assert.equal(
      (
        await request(
          `/api/parties/${room.code}/guess`,
          players[0].cookie,
          "POST",
          { roundId: room.roundId, answer: target.title },
        )
      ).status,
      409,
    );
    room = await (
      await request(`/api/parties/${room.code}/finish`, host.cookie, "POST", {
        roundId: room.roundId,
      })
    ).json();
    assert.equal(room.status, "finished");
    assert.equal(room.answer, null);
    const receipt = await (
      await request("/api/results", host.cookie, "POST", {
        sessionId: room.code,
      })
    ).json();
    assert.equal(receipt.type, "party");
    assert.equal(receipt.players.length, 50);
    assert.equal(receipt.players[0].score, 1000);
    assert.equal(receipt.players[49].score, 100);
    assert.ok(!JSON.stringify(receipt).includes(target.preview));
    assert.ok(!JSON.stringify(receipt).includes(host.player.id));
    assert.ok(!JSON.stringify(receipt).includes(room.code));
    for (const stream of streams) stream.abort.abort();
    await Promise.all(streams.map((s) => s.pump));
    await stop();
    await boot();
    assert.deepEqual(
      await (await request(`/api/results/${receipt.id}`)).json(),
      receipt,
    );
    assert.equal(
      (await (await request(`/api/parties/${room.code}`, host.cookie)).json())
        .status,
      "finished",
    );
  },
);
