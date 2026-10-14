// Memory only: share navigation data between routes, never persist identities,
// room state or answers in the service worker / browser storage.
const responses = new Map(),
  inFlight = new Map();
let generation = 0;
function lifetime(path) {
  if (["/api/catalog", "/api/player", "/api/config"].includes(path))
    return 60_000;
  if (path.startsWith("/api/leaderboard?")) return 15_000;
  return 0;
}
export function cachedResponse(path) {
  const entry = responses.get(path);
  if (entry && entry.expires > Date.now()) return entry.value;
  responses.delete(path);
  return undefined;
}
export function clearRequestCache() {
  generation++;
  responses.clear();
  inFlight.clear();
}
function invalidateMutation(path) {
  const affects = path.startsWith("/api/admin/")
    ? (key) => key === "/api/catalog" || key.startsWith("/api/leaderboard?")
    : path === "/api/player"
      ? (key) => key === "/api/player" || key.startsWith("/api/leaderboard?")
      : /\/(?:finish|leave|next|ready)$/.test(path)
        ? (key) => key.startsWith("/api/leaderboard?")
        : () => false;
  for (const key of responses.keys()) if (affects(key)) responses.delete(key);
  for (const [key, entry] of inFlight) {
    if (affects(key)) {
      entry.invalidated = true;
      inFlight.delete(key);
    }
  }
}
function saveResponse(path, value) {
  if (responses.size >= 40) responses.delete(responses.keys().next().value);
  responses.set(path, { value, expires: Date.now() + lifetime(path) });
}
function cancelled(signal) {
  return signal.reason || new DOMException("Aborted", "AbortError");
}
// Leaving one route cancels that subscriber, not a shared read needed by the
// next route. This also avoids duplicate guest creation during quick switching.
function subscribe(entry, signal) {
  if (signal?.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    const consumer = {};
    entry.consumers.add(consumer);
    clearTimeout(entry.releaseTimer);
    const release = () => {
      signal?.removeEventListener("abort", abort);
      entry.consumers.delete(consumer);
      if (!entry.settled && !entry.consumers.size) {
        clearTimeout(entry.releaseTimer);
        // Allow the next route to adopt this read; otherwise abort the actual
        // network request, freeing a browser connection slot promptly.
        entry.releaseTimer = setTimeout(() => {
          if (!entry.consumers.size) entry.controller.abort();
        }, 250);
      }
    };
    const abort = () => {
      release();
      reject(cancelled(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
    entry.promise.then(
      (value) => {
        release();
        resolve(value);
      },
      (error) => {
        release();
        reject(error);
      },
    );
  });
}
async function fetchJSON(path, options) {
  const {
    signal,
    timeout = path.startsWith("/api/admin") ? 90_000 : 15_000,
    ...init
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(cancelled(signal));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    const response = await fetch(path, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    const result = await response.json().catch(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error("伺服器暫時無法回應，請稍後重試。");
    });
    if (!response.ok)
      throw Object.assign(new Error(result.error || "操作失敗，請稍後重試。"), {
        status: response.status,
      });
    return result;
  } catch (error) {
    if (timedOut)
      throw Object.assign(new Error("連線逾時，請檢查網路後重試。"), {
        name: "TimeoutError",
      });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export async function request(path, options = {}) {
  if (options.signal?.aborted) throw cancelled(options.signal);
  const method = (options.method || "GET").toUpperCase();
  const ttl = method === "GET" ? lifetime(path) : 0;
  if (ttl) {
    const cached = cachedResponse(path);
    if (cached !== undefined) return cached;
    let pending = inFlight.get(path);
    if (!pending || pending.controller.signal.aborted) {
      const version = generation;
      pending = {
        controller: new AbortController(),
        consumers: new Set(),
        settled: false,
      };
      pending.promise = fetchJSON(path, {
        ...options,
        signal: pending.controller.signal,
      })
        .then((value) => {
          if (version === generation && !pending.invalidated)
            saveResponse(path, value);
          return value;
        })
        .finally(() => {
          pending.settled = true;
          clearTimeout(pending.releaseTimer);
          if (inFlight.get(path) === pending) inFlight.delete(path);
        });
      inFlight.set(path, pending);
    }
    return subscribe(pending, options.signal);
  }
  if (method !== "GET") invalidateMutation(path);
  const value = await fetchJSON(path, options);
  if (method !== "GET") {
    // Invalidate only data this action can change. Playing/guessing must not
    // discard the catalog and force every route to download it again.
    invalidateMutation(path);
    if (path === "/api/player" && method === "PATCH") saveResponse(path, value);
  }
  return value;
}
export function appleURL(song) {
  try {
    const url = new URL(song.url);
    if (!["music.apple.com", "itunes.apple.com"].includes(url.hostname))
      return "https://music.apple.com/tw/";
    url.hostname = "music.apple.com";
    url.protocol = "https:";
    url.searchParams.set("app", "music");
    return url.href;
  } catch {
    return "https://music.apple.com/tw/";
  }
}
export const regionLabels = {
  tw: "華語",
  kr: "K-POP",
  other: "其他／待分類",
};
export const categoryLabels = {
  girl: "女聲／女團",
  boy: "男聲／男團",
  other: "男女合唱",
};
export const statusLabels = {
  draft: "草稿",
  published: "已開放",
  archived: "已下架",
};
