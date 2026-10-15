import { applyPartyPatch } from "../../party-wire.mjs";
// A route owns one stream. Cleanup detaches callbacks before close so queued
// events from the previous room cannot update the next page or reconnect it.
export function subscribeLive(
  path,
  onState,
  onConnection,
  onExpired = () => {},
) {
  let source,
    stopped = false,
    suspended = false,
    deadline = Date.now() + 120_000,
    silenceTimer;
  function detach() {
    if (!source) return;
    source.onopen = null;
    source.onerror = null;
    source.close();
    source = null;
  }
  function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(silenceTimer);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", suspend);
    window.removeEventListener("pageshow", resume);
    detach();
  }
  function expire() {
    if (stopped) return;
    close();
    onConnection(false);
    onExpired("連線逾時，已停止重連。請按重新連線確認房間狀態。");
  }
  function healthy() {
    if (stopped) return;
    deadline = Date.now() + 120_000;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(expire, 120_000);
    onConnection(true);
  }
  function suspend() {
    if (stopped || suspended) return;
    suspended = true;
    detach();
    onConnection(false);
  }
  function resume() {
    if (stopped || document.hidden || !suspended) return;
    // PWA timers may be frozen in the background. Check wall time before
    // opening a fresh stream; switching apps must not reset the retry budget.
    if (Date.now() >= deadline) return expire();
    suspended = false;
    connect();
  }
  function visibility() {
    if (document.hidden) suspend();
    else resume();
  }
  function connect() {
    const stream = new EventSource(path);
    let snapshot;
    source = stream;
    const current = () => !stopped && source === stream;
    function disconnected() {
      if (!current()) return;
      // HTTP 204/terminal errors stop native EventSource reconnection.
      if (stream.readyState === 2) return expire();
      onConnection(false);
    }
    stream.onopen = () => {
      if (current()) onConnection(true);
    };
    stream.onerror = disconnected;
    stream.addEventListener("ping", () => {
      if (current()) healthy();
    });
    stream.addEventListener("closed", () => {
      if (!current()) return;
      close();
      onConnection(false);
      onExpired("房間連線已關閉，請重新連線查看結算。");
    });
    stream.addEventListener("state", (event) => {
      if (!current()) return;
      try {
        const state = JSON.parse(event.data);
        snapshot = state;
        healthy();
        if (["finished", "closed"].includes(state.status)) close();
        onState(state);
      } catch {
        disconnected();
      }
    });
    stream.addEventListener("patch", (event) => {
      if (!current()) return;
      try {
        snapshot = applyPartyPatch(snapshot, JSON.parse(event.data));
        healthy();
        onState(snapshot);
      } catch {
        // Do not continue with a partial roster or guess against stale state.
        // Manual reconnect fetches a full state and creates a fresh stream.
        expire();
      }
    });
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  silenceTimer = setTimeout(expire, 120_000);
  if (document.hidden) suspended = true;
  else connect();
  return close;
}

export function timeoutMessage(reason, mode) {
  if (reason === "idle") return "房間閒置超過 10 分鐘，已自動結束並保留成績。";
  if (reason === "disconnected")
    return mode === "party"
      ? "主機離線超過 2 分鐘，派對已自動結束並保留成績。"
      : "玩家離線超過 2 分鐘，對戰已自動結束並保留成績。";
  return "";
}
