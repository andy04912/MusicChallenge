import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("guest cookies, origin protection, independent room seats, SSE barriers and persistence work over HTTP", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "music-challenge-game-api-"));
  let child, origin;
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
        ADMIN_PASSWORD: "integration-game-password",
        BUY_ME_A_COFFEE_URL: "https://evil.test/donate",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    origin = await new Promise((yes, no) => {
      let out = "",
        err = "";
      const timer = setTimeout(() => no(new Error("startup timeout")), 10000);
      child.stderr.on("data", (c) => (err += c));
      child.stdout.on("data", (c) => {
        out += c;
        const match = out.match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          yes(match[1]);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        no(new Error(`exit ${code}: ${err}`));
      });
    });
  }
  async function stop() {
    if (child?.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
  }
  const streams = [];
  t.after(async () => {
    for (const controller of streams) controller.abort();
    await stop();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  });
  await boot();
  const database = new DatabaseSync(join(dir, "songs.sqlite"));
  database.exec("UPDATE songs SET status='published',categoryReview=0");
  database.close();
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
  const [first, config, catalog, leaderboard] = await Promise.all([
    request("/api/player"),
    request("/api/config"),
    request("/api/catalog"),
    request("/api/leaderboard?region=all"),
  ]);
  for (const publicRead of [config, catalog, leaderboard]) {
    assert.equal(publicRead.status, 200);
    assert.equal(publicRead.headers.get("set-cookie"), null);
  }
  const cookieA = first.headers.get("set-cookie").split(";")[0];
  assert.match(first.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const a = await first.json();
  const second = await request("/api/player");
  const cookieB = second.headers.get("set-cookie").split(";")[0];
  const b = await second.json();
  assert.notEqual(a.id, b.id);
  assert.equal(
    (
      await fetch(origin + "/api/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.test",
          Cookie: cookieA,
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal((await (await request("/api/config")).json()).donationUrl, null);
  let host = await (
    await request("/api/rooms", cookieA, "POST", {
      mode: "classic",
      region: "kr",
    })
  ).json();
  assert.equal(host.status, "waiting");
  const anonymousRoom = await request(`/api/rooms/${host.code}`);
  assert.equal(anonymousRoom.headers.get("set-cookie"), null);
  assert.equal((await anonymousRoom.json()).me, null);
  assert.equal(
    (await request(`/api/rooms/${host.code}/join`, undefined, "POST", {}))
      .status,
    401,
  );
  assert.equal(
    (await (await request(`/api/rooms/${host.code}`, cookieB)).json()).me,
    null,
  );
  assert.equal(
    (await request(`/api/rooms/${host.code}/events`, cookieB)).status,
    403,
  );
  let guest = await (
    await request(`/api/rooms/${host.code}/join`, cookieB, "POST", {})
  ).json();
  assert.equal(guest.status, "playing");
  const controller = new AbortController();
  streams.push(controller);
  const stream = await fetch(origin + `/api/rooms/${host.code}/events`, {
    headers: { Cookie: cookieA },
    signal: controller.signal,
  });
  assert.match(stream.headers.get("content-type"), /text\/event-stream/);
  assert.equal(stream.headers.get("x-accel-buffering"), "no");
  const reader = stream.body.getReader();
  let text = "";
  while (!text.includes("event: state"))
    text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"connected":true/);
  host = await (await request(`/api/rooms/${host.code}`, cookieA)).json();
  host = await (
    await request(`/api/rooms/${host.code}/reveal`, cookieA, "POST", {
      revision: host.me.revision,
    })
  ).json();
  assert.equal(host.answer, null);
  assert.equal(host.me.done, true);
  guest = await (
    await request(`/api/rooms/${host.code}/reveal`, cookieB, "POST", {
      revision: guest.me.revision,
    })
  ).json();
  assert.equal(guest.status, "revealed");
  assert.ok(guest.answer.title);
  assert.equal(guest.results.length, 2);
  controller.abort();
  await reader.cancel().catch(() => {});
  await stop();
  await boot();
  const restored = await (
    await request(`/api/rooms/${host.code}`, cookieA)
  ).json();
  assert.equal(restored.status, "revealed");
  assert.equal(restored.me.id, a.id);
  assert.equal(restored.results.length, 2);
  const payload = { sessionId: host.code, score: 999999 };
  assert.equal(
    (await request("/api/results", cookieA, "POST", payload)).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/rooms/${host.code}/finish`, cookieA, "POST", {
        revision: restored.me.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/results", undefined, "POST", payload)).status,
    401,
  );
  assert.equal(
    (
      await fetch(origin + "/api/results", {
        method: "POST",
        headers: {
          Origin: "https://other.test",
          Cookie: cookieA,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
    ).status,
    403,
  );
  const receipt = await (
    await request("/api/results", cookieA, "POST", payload)
  ).json();
  assert.equal(receipt.score, 0);
  assert.equal(receipt.outcome, "draw");
  const anonymous = await request(`/api/results/${receipt.id}`);
  assert.equal(anonymous.headers.get("set-cookie"), null);
  assert.match(anonymous.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await anonymous.json(), receipt);
  const unrelated = await request("/api/player");
  const unrelatedCookie = unrelated.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await request("/api/results", unrelatedCookie, "POST", payload)).status,
    403,
  );
  assert.equal((await request(`/api/results/${"x".repeat(24)}`)).status, 404);
  await stop();
  await boot();
  assert.deepEqual(
    await (await request(`/api/results/${receipt.id}`)).json(),
    receipt,
  );
  assert.deepEqual(
    await (await request("/api/results", cookieA, "POST", payload)).json(),
    receipt,
  );
});
