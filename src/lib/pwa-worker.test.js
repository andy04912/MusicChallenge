import { test, expect, vi } from "vitest";
import vm from "node:vm";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPWA, serviceWorkerSource } from "../../scripts/build-pwa.mjs";
function worker() {
  const handlers = {},
    cache = {
      addAll: vi.fn(async () => {}),
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["music-challenge-static-old", "other-app"]),
    delete: vi.fn(async () => {}),
  };
  const fetch = vi.fn(async () => new Response("online"));
  const self = {
    location: { origin: "https://music.test" },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => []) },
  };
  vm.runInNewContext(
    serviceWorkerSource({
      version: "new",
      assets: ["/assets/index-abc.js", "/offline.html"],
    }),
    { self, caches, fetch, URL, setTimeout, clearTimeout },
  );
  function request(url, options = {}) {
    let result;
    handlers.fetch({
      request: { method: "GET", mode: "cors", url, ...options },
      respondWith: (value) => {
        result = value;
      },
    });
    return result;
  }
  function lifecycle(name, extra = {}) {
    let result;
    handlers[name]({
      ...extra,
      waitUntil: (value) => {
        result = value;
      },
    });
    return result;
  }
  return { handlers, cache, caches, fetch, self, request, lifecycle };
}
test("service worker excludes API, cross-origin audio, admin assets and arbitrary URLs", () => {
  const app = worker();
  for (const url of [
    "https://music.test/api/catalog",
    "https://music.test/api/results/secret",
    "https://audio-ssl.itunes.apple.com/preview.m4a",
    "https://music.test/assets/AdminPage-secret.js",
    "https://music.test/secret.json",
    "https://music.test/assets/index-abc.js?token=x",
  ])
    expect(app.request(url)).toBeUndefined();
  expect(
    app.request("https://music.test/assets/index-abc.js", { method: "POST" }),
  ).toBeUndefined();
  expect(app.caches.open).not.toHaveBeenCalled();
});
test("navigation is network-first and never caches room, result or admin HTML", async () => {
  const app = worker();
  for (const route of ["/", "/duel/room", "/result/receipt", "/admin"])
    expect(
      await (
        await app.request(`https://music.test${route}`, { mode: "navigate" })
      ).text(),
    ).toBe("online");
  expect(app.cache.put).not.toHaveBeenCalled();
  app.fetch.mockRejectedValue(new Error("offline"));
  app.cache.match.mockResolvedValue(new Response("requires internet"));
  expect(
    await (
      await app.request("https://music.test/duel/room", { mode: "navigate" })
    ).text(),
  ).toBe("requires internet");
  expect(app.cache.match).toHaveBeenCalledWith("/offline.html");
  expect(app.cache.put).not.toHaveBeenCalled();
});
test("allowlisted assets are cache-first; install waits and old caches survive until activation", async () => {
  const app = worker();
  app.cache.match.mockResolvedValue(new Response("cached"));
  expect(
    await (await app.request("https://music.test/assets/index-abc.js")).text(),
  ).toBe("cached");
  expect(app.fetch).not.toHaveBeenCalled();
  await app.lifecycle("install");
  expect(app.cache.addAll).toHaveBeenCalledOnce();
  expect(app.self.skipWaiting).not.toHaveBeenCalled();
  expect(app.caches.delete).not.toHaveBeenCalled();
  await app.lifecycle("activate");
  expect(app.caches.delete).toHaveBeenCalledExactlyOnceWith(
    "music-challenge-static-old",
  );
  expect(app.self.clients.claim).toHaveBeenCalledOnce();
});
test("explicit update checks every page and refuses to interrupt an active challenge", async () => {
  const app = worker(),
    source = { postMessage: vi.fn() };
  let active = true;
  const client = {
    id: "page",
    postMessage: (message) =>
      app.handlers.message({
        data: {
          type: "PWA_CLIENT_STATUS",
          requestId: message.requestId,
          active,
        },
        source: { id: "page" },
      }),
  };
  app.self.clients.matchAll.mockResolvedValue([client]);
  await app.lifecycle("message", { data: { type: "ACTIVATE_UPDATE" }, source });
  expect(app.self.skipWaiting).not.toHaveBeenCalled();
  expect(source.postMessage).toHaveBeenCalledWith({
    type: "PWA_UPDATE_BLOCKED",
  });
  active = false;
  await app.lifecycle("message", { data: { type: "ACTIVATE_UPDATE" }, source });
  expect(app.self.skipWaiting).toHaveBeenCalledOnce();
});
test("build generates a versioned worker from real output and excludes admin chunks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "music-pwa-"));
  try {
    for (const folder of ["assets", "icons", "images"])
      await mkdir(path.join(dir, folder));
    for (const file of [
      "assets/index-abcd.js",
      "assets/AdminPage-private.js",
      "offline.html",
      "offline.css",
      "manifest.webmanifest",
      "images/music-challenge-mark.svg",
      "icons/icon-192.png",
      "icons/icon-512.png",
      "icons/maskable-512.png",
      "icons/apple-touch-icon.png",
    ])
      await writeFile(path.join(dir, file), file);
    const first = await buildPWA(dir);
    expect(first.assets).toContain("/assets/index-abcd.js");
    expect(first.assets.some((value) => value.includes("AdminPage"))).toBe(
      false,
    );
    expect(await readFile(path.join(dir, "sw.js"), "utf8")).toContain(
      first.version,
    );
    await writeFile(path.join(dir, "offline.html"), "updated");
    expect((await buildPWA(dir)).version).not.toBe(first.version);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
