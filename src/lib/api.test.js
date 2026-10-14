import { afterEach, expect, test, vi } from "vitest";
import { cachedResponse, clearRequestCache, request } from "./api.js";

const json = (value) => new Response(JSON.stringify(value));
afterEach(() => {
  clearRequestCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("navigation reads are reused briefly, then refresh from the server", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => json([{ id: 1 }]));
  vi.stubGlobal("fetch", fetch);
  await request("/api/catalog");
  await request("/api/catalog");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cachedResponse("/api/catalog")).toEqual([{ id: 1 }]);
  await vi.advanceTimersByTimeAsync(60_001);
  expect(cachedResponse("/api/catalog")).toBeUndefined();
  await request("/api/catalog");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("rapid route switches share a pending read without one route cancelling the next", async () => {
  let complete;
  const fetch = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const leaving = new AbortController();
  const first = request("/api/player", { signal: leaving.signal });
  const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
  leaving.abort();
  const next = request("/api/player");
  complete(json({ id: "one-player", nickname: "Tester" }));
  await cancelled;
  expect(await next).toMatchObject({ id: "one-player" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
});

test("finishing invalidates rankings and pending reads cannot restore stale scores", async () => {
  const path = "/api/leaderboard?mode=classic&limit=5";
  let complete;
  vi.stubGlobal(
    "fetch",
    vi.fn((url) =>
      url === path
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve(json({ status: "finished" })),
    ),
  );
  const oldRead = request(path);
  await request("/api/runs/test/finish", { method: "POST" });
  complete(json({ entries: [{ score: 0 }] }));
  await oldRead;
  expect(cachedResponse(path)).toBeUndefined();
});
test("creating, playing and guessing preserve setup reads across mode switches", async () => {
  const fetch = vi.fn(async () => json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const reads = ["/api/catalog", "/api/player", "/api/config"];
  for (const path of reads) await request(path);
  for (const path of [
    "/api/parties",
    "/api/rooms",
    "/api/runs/test/play",
    "/api/runs/test/guess",
    "/api/runs/test/finish",
  ])
    await request(path, { method: "POST" });
  for (const path of reads) await request(path);
  for (const path of reads)
    expect(fetch.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
});
test("unrelated mutations do not discard a catalog read still in progress", async () => {
  let complete;
  const fetch = vi.fn((path) =>
    path === "/api/catalog"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(json({ status: "playing" })),
  );
  vi.stubGlobal("fetch", fetch);
  const reading = request("/api/catalog");
  await request("/api/rooms", { method: "POST" });
  const next = request("/api/catalog");
  complete(json([{ id: 123 }]));
  await Promise.all([reading, next]);
  expect(await request("/api/catalog")).toEqual([{ id: 123 }]);
  expect(
    fetch.mock.calls.filter(([path]) => path === "/api/catalog"),
  ).toHaveLength(1);
});
test("admin catalog edits invalidate cached and overlapping old catalog snapshots", async () => {
  let complete;
  const fetch = vi.fn((path) =>
    path === "/api/catalog"
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : Promise.resolve(json({ updated: true })),
  );
  vi.stubGlobal("fetch", fetch);
  const oldRead = request("/api/catalog");
  await request("/api/admin/songs", { method: "PATCH" });
  complete(json([{ id: 1 }]));
  await oldRead;
  expect(cachedResponse("/api/catalog")).toBeUndefined();
  fetch.mockResolvedValueOnce(json([{ id: 2 }]));
  expect(await request("/api/catalog")).toEqual([{ id: 2 }]);
  await request("/api/admin/import", { method: "POST" });
  expect(cachedResponse("/api/catalog")).toBeUndefined();
});

test("player changes update the short-lived player snapshot", async () => {
  const fetch = vi.fn(async () => json({ id: "player", nickname: "New name" }));
  vi.stubGlobal("fetch", fetch);
  await request("/api/player", {
    method: "PATCH",
    body: JSON.stringify({ nickname: "New name" }),
  });
  expect(await request("/api/player")).toMatchObject({ nickname: "New name" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("active games, rooms and admin sessions always read current server state", async () => {
  const fetch = vi.fn(async () => json({}));
  vi.stubGlobal("fetch", fetch);
  for (const path of [
    "/api/runs/test",
    "/api/rooms/test",
    "/api/parties/test",
    "/api/admin/session",
  ]) {
    await request(path);
    await request(path);
    expect(cachedResponse(path)).toBeUndefined();
  }
  expect(fetch).toHaveBeenCalledTimes(8);
});

test("failed navigation reads are not cached and can be retried", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Busy" }), { status: 503 }),
    )
    .mockResolvedValueOnce(json([]));
  vi.stubGlobal("fetch", fetch);
  await expect(request("/api/catalog")).rejects.toMatchObject({ status: 503 });
  expect(await request("/api/catalog")).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("a stalled response body times out, exits loading and permits a fresh retry", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async (_url, { signal }) => ({
    ok: true,
    json: () =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  }));
  vi.stubGlobal("fetch", fetch);
  const pending = request("/api/catalog");
  const timedOut = expect(pending).rejects.toMatchObject({
    name: "TimeoutError",
    message: "連線逾時，請檢查網路後重試。",
  });
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
  fetch.mockResolvedValueOnce(json([]));
  expect(await request("/api/catalog")).toEqual([]);
});

test("a mutation times out without automatically submitting it twice", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const pending = request("/api/runs/test/guess", { method: "POST" });
  const timedOut = expect(pending).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(15_000);
  await timedOut;
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("leaving the last subscriber cancels the underlying request and permits a fresh route read", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const route = new AbortController();
  const pending = request("/api/catalog", { signal: route.signal });
  const cancelled = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  route.abort();
  await cancelled;
  await vi.advanceTimersByTimeAsync(251);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  fetch.mockResolvedValueOnce(json([{ id: 2 }]));
  expect(await request("/api/catalog")).toEqual([{ id: 2 }]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
