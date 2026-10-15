// Explicit opt-in live capacity probe. Creates test identities/party rooms;
// finishes rooms in finally, never creates public result receipts or scores.
import { mkdir, writeFile, appendFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { applyPartyPatch } from "../party-wire.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((x) => x.replace(/^--/, "").split("=")),
);
if (!args.origin || args.confirm !== "live-load-test")
  throw new Error(
    "Required: --origin=https://your-site --confirm=live-load-test",
  );
const origin = new URL(args.origin).origin;
const levels = (args.rooms || "1,2,4,8").split(",").map(Number);
if (levels.some((n) => !Number.isInteger(n) || n < 1 || n > 16))
  throw new Error("Room stages must be 1..16");
const out = resolve(args.out || `data/load-test-${Date.now()}`);
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rooms = [],
  streams = [],
  reports = [];
let phase = "baseline",
  stopReason = "",
  cleaning = false,
  dropped = 0;
let requests = [],
  health = [],
  pushes = [],
  bytes = 0,
  states = 0,
  pings = 0;
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
const start = Date.now();
const globalTimer = setTimeout(() => {
  stopReason = "12 minute maximum runtime";
}, 720000);
process.on("SIGINT", () => {
  stopReason = "SIGINT";
});
process.on("SIGTERM", () => {
  stopReason = "SIGTERM";
});
const log = async (type, data) => {
  const row = { time: new Date().toISOString(), type, phase, ...data };
  console.log(JSON.stringify(row));
  await appendFile(resolve(out, "events.jsonl"), JSON.stringify(row) + "\n");
};
function stats(rows) {
  const times = rows.map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) =>
    Math.round(times[Math.max(0, Math.ceil(times.length * p) - 1)] || 0);
  return {
    count: rows.length,
    failed: rows.filter((r) => !r.ok).length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: q(1),
    statuses: rows.reduce(
      (a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a),
      {},
    ),
  };
}
async function req(
  path,
  cookie,
  input,
  method = input === undefined ? "GET" : "POST",
  record = true,
) {
  const began = performance.now();
  let status = 0;
  try {
    const response = await fetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    const data = await response.json();
    if (record)
      requests.push({ ms: performance.now() - began, ok: response.ok, status });
    if (!response.ok)
      throw Object.assign(new Error(`HTTP ${status} ${path}`), {
        recorded: true,
      });
    return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  } catch (error) {
    if (record && !error.recorded)
      requests.push({ ms: performance.now() - began, ok: false, status });
    throw error;
  }
}
async function guard() {
  try {
    await access(resolve(out, "STOP"));
    stopReason ||= "external resource guard";
  } catch {}
  if (stopReason) throw new Error(stopReason);
  if (dropped) throw new Error(`${dropped} unexpected SSE disconnects`);
  if (streams.some((s) => s.active && Date.now() - s.lastEvent > 35000))
    throw new Error("SSE heartbeat stale >35 seconds");
}
async function openStream(room, cookie) {
  const abort = new AbortController();
  const s = { abort, active: false, revision: -1, lastEvent: Date.now() };
  streams.push(s);
  room.streams.push(s);
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await fetch(
      `${origin}/api/parties/${room.code}/events${args.compact === "1" ? "?compact=1" : ""}`,
      { headers: { Cookie: cookie }, signal: abort.signal },
    );
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      throw new Error(`SSE ${response.status}`);
    s.active = true;
    s.pump = (async () => {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          pending += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = pending.indexOf("\n\n")) !== -1) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            if (frame.includes("event: closed")) s.expectedClose = true;
            if (frame.includes("event: ping")) {
              pings++;
              s.lastEvent = Date.now();
            }
            if (
              frame.includes("event: state") ||
              frame.includes("event: patch")
            ) {
              const data = frame
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (data) {
                const parsed = JSON.parse(data.slice(6));
                const v = frame.includes("event: patch")
                  ? applyPartyPatch(s.latest, parsed)
                  : parsed;
                s.latest = v;
                s.revision = v.revision;
                states++;
                s.lastEvent = Date.now();
              }
            }
          }
        }
      } catch (error) {
        if (!abort.signal.aborted && !cleaning) s.error = error.message;
      } finally {
        s.active = false;
        if (!cleaning && !abort.signal.aborted && !s.expectedClose) dropped++;
      }
    })();
    const until = Date.now() + 5000;
    while (s.revision < 0 && Date.now() < until && s.active) await sleep(10);
    if (s.revision < 0) throw new Error("SSE first state timeout");
  } finally {
    clearTimeout(timeout);
  }
}
async function pool(items, concurrency, fn) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i], i);
      }
    }),
  );
}
async function action(room, op, cookie = room.host, extra = {}) {
  const r = await req(`/api/parties/${room.code}/${op}`, cookie, {
    roundId: room.roundId,
    ...extra,
  });
  room.roundId = r.data.roundId;
  return r.data;
}
async function broadcast(room, op, cookie = room.host) {
  const t = performance.now(),
    data = await action(room, op, cookie);
  const deadline = Date.now() + 5000;
  while (
    room.streams.some((s) => s.revision < data.revision) &&
    Date.now() < deadline
  )
    await sleep(5);
  const ok = room.streams.every((s) => s.active && s.revision >= data.revision);
  pushes.push({ ms: performance.now() - t, ok, status: ok ? 200 : 0 });
  if (!ok)
    throw new Error("Broadcast did not reach every member within 5 seconds");
}
async function createRoom(index) {
  const host = (await req("/api/player")).cookie;
  const data = (
    await req("/api/parties", host, { region: index % 2 ? "tw" : "kr" })
  ).data;
  const room = {
    host,
    code: data.code,
    roundId: data.roundId,
    players: [],
    streams: [],
  };
  rooms.push(room);
  // Save only local private recovery information; never log identity cookies.
  await writeFile(
    resolve(out, "cleanup-private.json"),
    JSON.stringify(
      rooms.map(({ host, code, roundId }) => ({ host, code, roundId })),
    ),
  );
  await openStream(room, host);
  await pool(Array.from({ length: 50 }), 5, async () => {
    await guard();
    const cookie = (await req("/api/player")).cookie;
    await req(`/api/parties/${room.code}/join`, cookie, {});
    room.players.push(cookie);
    await openStream(room, cookie);
  });
  await action(room, "start");
  await log("room-ready", {
    rooms: rooms.length,
    connections: streams.filter((s) => s.active).length,
  });
}
async function probeHealth() {
  const t = performance.now();
  try {
    await req("/api/health", undefined, undefined, "GET", false);
    health.push({ ms: performance.now() - t, ok: true, status: 200 });
  } catch {
    health.push({ ms: performance.now() - t, ok: false, status: 0 });
    stopReason ||= "health request failed";
  }
}
async function phaseRun(name, duration, rate) {
  phase = name;
  requests = [];
  health = [];
  pushes = [];
  const b = bytes,
    st = states,
    pi = pings,
    cpu = process.cpuUsage(),
    t = performance.now();
  lag.reset();
  await log("phase-start", {
    seconds: duration,
    targetRps: rate,
    connections: streams.filter((s) => s.active).length,
  });
  const pending = new Set();
  let launched = 0,
    nextHealth = 0,
    maxPending = 0;
  const members = rooms.flatMap((room) =>
    room.players.map((cookie) => ({ room, cookie })),
  );
  while (performance.now() - t < duration * 1000) {
    await guard();
    const elapsed = performance.now() - t;
    if (elapsed >= nextHealth) {
      nextHealth += 1000;
      const p = probeHealth().finally(() => pending.delete(p));
      pending.add(p);
    }
    if (rate && launched <= (elapsed / 1000) * rate) {
      if (pending.size >= 50)
        throw new Error("Load generator reached 50 pending requests");
      const n = launched++,
        member = members[n % members.length];
      const operation =
        n % 5 === 0
          ? req("/api/catalog")
          : n % 5 === 1
            ? req("/api/leaderboard?mode=endless")
            : action(member.room, "guess", member.cookie, {
                answer: "load-test-deliberately-wrong-928573",
              });
      const p = operation.catch(() => {}).finally(() => pending.delete(p));
      pending.add(p);
      maxPending = Math.max(maxPending, pending.size);
    }
    if (requests.length >= 20) {
      const recent = stats(requests.slice(-100));
      if (recent.failed / recent.count > 0.01 || recent.p95 > 1500)
        throw new Error(`Request safety threshold ${JSON.stringify(recent)}`);
    }
    if (health.length >= 5 && stats(health.slice(-5)).p95 > 1500)
      throw new Error("Health p95 >1500ms");
    await sleep(5);
  }
  await Promise.all(pending);
  const elapsed = (performance.now() - t) / 1000,
    usage = process.cpuUsage(cpu);
  const report = {
    phase,
    rooms: rooms.length,
    connections: streams.filter((s) => s.active).length,
    durationSeconds: +elapsed.toFixed(1),
    targetRps: rate,
    achievedRps: +(requests.length / elapsed).toFixed(1),
    requests: stats(requests),
    health: stats(health),
    sse: {
      dropped,
      states: states - st,
      pings: pings - pi,
      receivedMB: +((bytes - b) / 1e6).toFixed(2),
    },
    generator: {
      cpuOneCorePercent: +(
        (usage.user + usage.system) /
        (elapsed * 10000)
      ).toFixed(1),
      rssMB: Math.round(process.memoryUsage().rss / 1e6),
      eventLoopP99ms: +(lag.percentile(99) / 1e6).toFixed(1),
      maxPending,
    },
  };
  reports.push(report);
  await log("phase-result", report);
  await writeFile(
    resolve(out, "report.json"),
    JSON.stringify(
      { origin, start: new Date(start).toISOString(), reports },
      null,
      2,
    ),
  );
}
try {
  await phaseRun("baseline", 10, 0);
  for (const count of levels) {
    phase = "setup";
    while (rooms.length < count) {
      await guard();
      await createRoom(rooms.length);
    }
    await phaseRun(`idle-${count * 51}`, 20, 0);
    if (args.profile === "idle") continue;
    if (args.profile !== "fanout")
      await phaseRun(`active-${count * 51}`, 30, Math.min(count * 10, 80));
    for (
      let burst = 0;
      burst < Math.min(5, Number(args.bursts || 1));
      burst++
    ) {
      phase = `fanout-${count * 51}`;
      pushes = [];
      requests = [];
      const fanoutStart = performance.now(),
        fanoutBytes = bytes,
        fanoutCPU = process.cpuUsage();
      lag.reset();
      // Giving up uses the same all-member state fan-out as correct answers,
      // without adding fictitious scores. Ten concurrent updates per full room.
      await pool(rooms, 2, async (room) => {
        await pool(room.players.slice(0, 10), 5, (cookie) =>
          broadcast(room, "giveup", cookie),
        );
        await broadcast(room, "reveal");
        await broadcast(room, "next");
        await broadcast(room, "start");
      });
      const fanoutSeconds = (performance.now() - fanoutStart) / 1000,
        cpuUsed = process.cpuUsage(fanoutCPU);
      const result = {
        phase,
        connections: streams.filter((s) => s.active).length,
        requests: stats(requests),
        broadcastDelivery: stats(pushes),
        dropped,
        durationSeconds: +fanoutSeconds.toFixed(2),
        receivedMB: +((bytes - fanoutBytes) / 1e6).toFixed(2),
        generator: {
          cpuOneCorePercent: +(
            (cpuUsed.user + cpuUsed.system) /
            (fanoutSeconds * 10000)
          ).toFixed(1),
          eventLoopP99ms: +(lag.percentile(99) / 1e6).toFixed(1),
        },
      };
      reports.push(result);
      await log("fanout-result", result);
      if (
        result.broadcastDelivery.failed ||
        result.broadcastDelivery.p95 > 1500
      )
        throw new Error("Fanout safety threshold");
      await guard();
    }
  }
} catch (error) {
  stopReason ||= error.message;
  await log("stopped", {
    reason: stopReason,
    requests: stats(requests),
    health: stats(health),
  });
} finally {
  cleaning = true;
  phase = "cleanup";
  const cleanup = [];
  await pool(rooms, 2, async (room) => {
    try {
      const current = (await req(`/api/parties/${room.code}`, room.host)).data;
      room.roundId = current.roundId;
      if (current.status !== "finished") await action(room, "finish");
      const final = (await req(`/api/parties/${room.code}`, room.host)).data;
      cleanup.push({ code: room.code, status: final.status });
    } catch (error) {
      cleanup.push({ code: room.code, error: error.message });
    }
  });
  for (const s of streams) s.abort.abort();
  await Promise.allSettled(streams.map((s) => s.pump));
  clearTimeout(globalTimer);
  lag.disable();
  await log("cleanup-result", {
    rooms: cleanup,
    remainingConnections: streams.filter((s) => s.active).length,
  });
  await writeFile(
    resolve(out, "report.json"),
    JSON.stringify(
      {
        origin,
        start: new Date(start).toISOString(),
        end: new Date().toISOString(),
        stopReason,
        reports,
        cleanup,
      },
      null,
      2,
    ),
  );
  console.log(`REPORT ${resolve(out, "report.json")}`);
}
