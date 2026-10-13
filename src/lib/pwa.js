const dismissKey = "music-challenge-install-dismissed";
export function installedMode(win = window) {
  return Boolean(
    win.matchMedia?.("(display-mode: standalone)").matches ||
    win.navigator.standalone,
  );
}
export function installInstructions(nav = navigator) {
  const ios =
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  return ios
    ? "使用 Safari 開啟網站，按分享，再選「加入主畫面」，即可從主畫面開啟 Music Challenge。"
    : "開啟瀏覽器選單，選擇「安裝應用程式」或「加入主畫面」。如果沒有這個選項，可改用 Chrome、Edge 或手機 Safari。";
}
function readDismissed() {
  try {
    return localStorage.getItem(dismissKey) === "1";
  } catch {
    return false;
  }
}
let snapshot = {
  installed: false,
  dismissed: readDismissed(),
  native: false,
  update: false,
  updating: false,
  message: "",
};
let started = false,
  deferred = null,
  registration = null,
  active = false,
  reloadRequested = false,
  reloaded = false;
const listeners = new Set();
function publish(next) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}
export const getPWASnapshot = () => snapshot;
export function subscribePWA(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setPWAActivity(value) {
  active = Boolean(value);
}
export function dismissInstall() {
  try {
    localStorage.setItem(dismissKey, "1");
  } catch {}
  publish({ dismissed: true });
}
export async function requestInstall() {
  if (!deferred || snapshot.installed) return "manual";
  const event = deferred;
  deferred = null;
  publish({ native: false });
  try {
    await event.prompt();
    const result = await event.userChoice;
    if (result?.outcome === "accepted") publish({ installed: true });
    if (result?.outcome === "dismissed") dismissInstall();
    return result?.outcome || "dismissed";
  } catch {
    return "manual";
  }
}
export function applyUpdate() {
  if (active || !registration?.waiting || snapshot.updating) return false;
  reloadRequested = true;
  publish({ updating: true, message: "" });
  registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
  return true;
}
export function initializePWA({
  register = true,
  reload = () => window.location.reload(),
} = {}) {
  if (started) return;
  started = true;
  publish({ installed: installedMode(), dismissed: readDismissed() });
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener?.("change", () =>
    publish({ installed: installedMode() }),
  );
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    publish({ native: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    publish({ installed: true, native: false });
  });
  if (!register || !navigator.serviceWorker || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "PWA_UPDATE_QUERY")
      event.source?.postMessage({
        type: "PWA_CLIENT_STATUS",
        requestId: event.data.requestId,
        active,
      });
    if (event.data?.type === "PWA_UPDATE_BLOCKED") {
      reloadRequested = false;
      publish({
        updating: false,
        message: "其他分頁仍在使用中，請結束挑戰或關閉分頁後再更新。",
      });
    }
    if (event.data?.type === "PWA_UPDATE_APPROVED" && !active) {
      // All open pages approved this explicit update while idle. Refresh each
      // once so no tab continues requesting removed chunks from the old build.
      reloadRequested = true;
      publish({ updating: true, message: "" });
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadRequested && !active && !reloaded) {
      reloaded = true;
      reload();
    }
  });
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((result) => {
      registration = result;
      const waiting = () => {
        if (result.waiting && navigator.serviceWorker.controller)
          publish({ update: true });
      };
      waiting();
      result.addEventListener("updatefound", () => {
        const worker = result.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") waiting();
        });
      });
    })
    .catch(() => {
      /* The online game remains available if registration is blocked. */
    });
}
