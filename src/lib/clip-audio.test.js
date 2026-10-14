import { test, expect, vi, afterEach } from "vitest";
import { ClipAudio } from "./clip-audio.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(duration = 30) {
  const sources = [];
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration })),
    createBufferSource() {
      const source = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(source);
      return source;
    },
  };
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1])));
  vi.stubGlobal("fetch", fetchMock);
  return {
    context,
    sources,
    fetchMock,
    player: new ClipAudio(
      "https://audio-ssl.itunes.apple.com/preview.m4a",
      vi.fn(),
      () => context,
    ),
  };
}
test("audio graph plays the prefix once, stops at its boundary and reuses decoded audio", async () => {
  const { player, context, sources, fetchMock } = setup();
  await player.play(1);
  expect(sources[0].loop).toBe(false);
  expect(sources[0].start).toHaveBeenCalledWith(0, 0, 1);
  context.currentTime = 500.75;
  expect(player.position).toBe(1);
  player.pause();
  expect(sources[0].stop).toHaveBeenCalledOnce();
  await player.play(6);
  expect(sources[1].loop).toBe(false);
  expect(sources[1].start).toHaveBeenCalledWith(0, 0, 6);
  expect(fetchMock).toHaveBeenCalledOnce();
  await player.play(Infinity, false);
  expect(sources[2].loop).toBe(false);
  expect(sources[2].start).toHaveBeenCalledWith(0, 0, 30);
  player.dispose();
  expect(sources[2].stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});
test("short audio clamps the prefix and background interruption stops playback", async () => {
  const { player, context, sources } = setup(0.6);
  await player.play(1);
  expect(sources[0].start).toHaveBeenCalledWith(0, 0, 0.6);
  context.state = "interrupted";
  context.onstatechange();
  expect(player.playing).toBe(false);
  expect(sources[0].stop).toHaveBeenCalledOnce();
  player.dispose();
});

test("natural completion stays stopped until another explicit play", async () => {
  const { player, sources } = setup();
  await player.play(1);
  sources[0].onended();
  expect(player.playing).toBe(false);
  expect(player.position).toBe(1);
  expect(sources).toHaveLength(1);
  await player.play(6);
  expect(sources).toHaveLength(2);
  expect(sources[1].start).toHaveBeenCalledWith(0, 0, 6);
  expect(sources[1].loop).toBe(false);
  player.dispose();
});
test("cancelled decoding cannot start audio later", async () => {
  const { player, context, sources } = setup();
  let finish;
  context.decodeAudioData.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = player.play(1);
  await vi.waitFor(() => expect(finish).toBeDefined());
  player.pause();
  finish({ duration: 30 });
  expect(await pending).toBeNull();
  expect(sources).toHaveLength(0);
  player.dispose();
});
test("failed loading is retryable without playing an unrestricted fallback", async () => {
  const { player, sources, fetchMock } = setup();
  fetchMock.mockRejectedValueOnce(new Error("network"));
  await expect(player.play(1)).rejects.toThrow("network");
  expect(sources).toHaveLength(0);
  await player.play(1);
  expect(sources[0].start).toHaveBeenCalledWith(0, 0, 1);
  player.dispose();
});

test("preload shares one fetch/decode and does not create or resume the live context", async () => {
  const { context, fetchMock, sources } = setup();
  const output = vi.fn(() => context),
    decode = vi.fn(async () => ({ duration: 90 }));
  const player = new ClipAudio(
    "https://audio-ssl.itunes.apple.com/test.m4a",
    vi.fn(),
    output,
    () => ({ decodeAudioData: decode }),
  );
  const first = player.preload(),
    second = player.preload();
  expect(first).toBe(second);
  expect(await first).toEqual({ duration: 90 });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
  expect(output).not.toHaveBeenCalled();
  expect(context.resume).not.toHaveBeenCalled();
  await player.play(6);
  expect(output).toHaveBeenCalledOnce();
  expect(context.resume).toHaveBeenCalledOnce();
  expect(context.decodeAudioData).not.toHaveBeenCalled();
  expect(sources[0].start).toHaveBeenCalledWith(0, 0, 6);
  player.dispose();
});

test("disposed preload aborts and ignores late offline decoding", async () => {
  const { context, fetchMock } = setup();
  let finish;
  const player = new ClipAudio(
    "https://audio-ssl.itunes.apple.com/test.m4a",
    vi.fn(),
    () => context,
    () => ({
      decodeAudioData: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  );
  const pending = player.preload();
  await vi.waitFor(() => expect(finish).toBeDefined());
  const signal = fetchMock.mock.calls[0][1].signal;
  player.dispose();
  finish({ duration: 30 });
  expect(await pending).toBeNull();
  expect(signal.aborted).toBe(true);
  expect(player.buffer).toBeNull();
  expect(await player.play(1)).toBeNull();
});

test("offline decode failure can retry preload successfully", async () => {
  const { context, fetchMock } = setup();
  const decode = vi
    .fn()
    .mockRejectedValueOnce(new Error("invalid audio"))
    .mockResolvedValue({ duration: 30 });
  const player = new ClipAudio(
    "https://audio-ssl.itunes.apple.com/test.m4a",
    vi.fn(),
    () => context,
    () => ({ decodeAudioData: decode }),
  );
  await expect(player.preload()).rejects.toThrow("invalid audio");
  expect(await player.preload()).toEqual({ duration: 30 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(context.resume).not.toHaveBeenCalled();
  player.dispose();
});
test("a stalled preview body times out and retries with a fresh signal", async () => {
  vi.useFakeTimers();
  const { player, fetchMock } = setup();
  fetchMock.mockImplementationOnce(async (_url, { signal }) => ({
    ok: true,
    arrayBuffer: () =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
  }));
  const loading = player.preload();
  const timeout = expect(loading).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(20_000);
  await timeout;
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(await player.preload()).not.toBeNull();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
  player.dispose();
});
