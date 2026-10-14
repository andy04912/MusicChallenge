import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { subscribeRoom } from "./room-client.js";
import { subscribeParty } from "./party-client.js";
let streams;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  streams = [];
  vi.stubGlobal(
    "EventSource",
    class {
      handlers = {};
      close = vi.fn();
      constructor(path) {
        this.path = path;
        streams.push(this);
      }
      addEventListener(name, callback) {
        this.handlers[name] = callback;
      }
      emit(name, value = {}) {
        this.handlers[name]?.({ data: JSON.stringify(value) });
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test.each([subscribeRoom, subscribeParty])(
  "%s releases immediately on navigation and ignores queued old events",
  (subscribe) => {
    const state = vi.fn(),
      connection = vi.fn(),
      expired = vi.fn();
    const stop = subscribe("room", state, connection, expired);
    const oldError = streams[0].onerror;
    stop();
    oldError();
    streams[0].emit("state", { status: "playing" });
    vi.advanceTimersByTime(180_000);
    expect(streams[0].close).toHaveBeenCalledTimes(1);
    expect(state).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
  },
);
test("repeated transport open/error cannot keep reconnection alive forever", () => {
  const expired = vi.fn();
  subscribeRoom("room", vi.fn(), vi.fn(), expired);
  streams[0].onerror();
  for (let i = 0; i < 11; i++) {
    vi.advanceTimersByTime(10_000);
    streams[0].onopen();
    streams[0].onerror();
  }
  vi.advanceTimersByTime(10_000);
  expect(streams[0].close).toHaveBeenCalledTimes(1);
  expect(expired).toHaveBeenCalledTimes(1);
});
test("an open but silent connection times out and releases its stream", () => {
  const expired = vi.fn(),
    connection = vi.fn();
  subscribeParty("room", vi.fn(), connection, expired);
  streams[0].onopen();
  vi.advanceTimersByTime(120_000);
  expect(streams[0].close).toHaveBeenCalledTimes(1);
  expect(connection).toHaveBeenLastCalledWith(false);
  expect(expired).toHaveBeenCalledTimes(1);
});
test("a terminal HTTP response offers recovery without waiting for another reconnect", () => {
  const expired = vi.fn();
  subscribeRoom("room", vi.fn(), vi.fn(), expired);
  streams[0].readyState = 2;
  streams[0].onerror();
  expect(expired).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(180_000);
  expect(expired).toHaveBeenCalledTimes(1);
  expect(streams[0].close).toHaveBeenCalledTimes(1);
});
test("healthy pings preserve a connection, a finished state stops it without reconnection", () => {
  const state = vi.fn(),
    expired = vi.fn();
  subscribeParty("room", state, vi.fn(), expired);
  for (let i = 0; i < 20; i++) {
    vi.advanceTimersByTime(15_000);
    streams[0].emit("ping");
  }
  expect(streams[0].close).not.toHaveBeenCalled();
  streams[0].emit("state", { status: "finished", endReason: "idle" });
  streams[0].emit("closed");
  vi.advanceTimersByTime(180_000);
  expect(state).toHaveBeenCalledWith({ status: "finished", endReason: "idle" });
  expect(expired).not.toHaveBeenCalled();
  expect(streams[0].close).toHaveBeenCalledTimes(1);
});

test.each([subscribeRoom, subscribeParty])(
  "%s replaces a background PWA connection once and ignores its queued events",
  (subscribe) => {
    const state = vi.fn(),
      expired = vi.fn();
    const stop = subscribe("room", state, vi.fn(), expired);
    streams[0].emit("state", { status: "playing", revision: 1 });
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    expect(streams[0].close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(streams).toHaveLength(2);
    streams[0].emit("state", { status: "finished", revision: 100 });
    streams[1].emit("state", { status: "playing", revision: 2 });
    expect(state).toHaveBeenCalledTimes(2);
    expect(state).toHaveBeenLastCalledWith({ status: "playing", revision: 2 });
    expect(expired).not.toHaveBeenCalled();
    stop();
  },
);
test("foreground checks elapsed time even if the OS froze background timers", () => {
  const expired = vi.fn();
  subscribeParty("room", vi.fn(), vi.fn(), expired);
  window.dispatchEvent(new Event("pagehide"));
  // Jump the clock without executing any timer, as a suspended PWA may do.
  vi.setSystemTime(Date.now() + 180_000);
  window.dispatchEvent(new Event("pageshow"));
  expect(streams).toHaveLength(1);
  expect(expired).toHaveBeenCalledTimes(1);
  vi.runAllTimers();
  expect(expired).toHaveBeenCalledTimes(1);
});
test("leaving the route while suspended removes lifecycle listeners", () => {
  const stop = subscribeRoom("room", vi.fn(), vi.fn());
  window.dispatchEvent(new Event("pagehide"));
  stop();
  window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(streams).toHaveLength(1);
  expect(streams[0].close).toHaveBeenCalledTimes(1);
});
