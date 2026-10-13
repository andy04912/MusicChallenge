import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PreviewPlayer from "./PreviewPlayer.jsx";

const song = {
  preview: "https://audio-ssl.itunes.apple.com/test.m4a",
  url: "https://music.apple.com/tw/song/1",
};
let decode, create, resume, liveContext;
beforeEach(() => {
  decode = vi.fn(async () => ({ duration: 30 }));
  create = vi.fn(() => ({
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
  }));
  resume = vi.fn(async () => {});
  liveContext = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1]))),
  );
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      decodeAudioData = decode;
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        liveContext();
      }
      state = "running";
      currentTime = 0;
      destination = {};
      resume = resume;
      close = async () => {};
      decodeAudioData = decode;
      createBufferSource = create;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

test("resumed revealed rounds show full duration before preloading finishes", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  const { rerender } = render(
    <PreviewPlayer song={song} revealed limit={6} fullDuration={90} />,
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "90");
  expect(screen.getByText("完整試聽")).toBeVisible();
  rerender(<PreviewPlayer song={song} revealed limit={6} fullDuration={8} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "8");
  rerender(<PreviewPlayer song={song} revealed limit={6} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "30");
  rerender(<PreviewPlayer song={song} limit={6} fullDuration={90} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "6");
});

test("mount preloads silently; playback and scoring require an explicit click", async () => {
  const heard = vi.fn();
  render(<PreviewPlayer song={song} limit={1} onPlaybackStarted={heard} />);
  expect(screen.getByRole("button", { name: "正在準備試聽" })).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "播放試聽" })).toBeEnabled(),
  );
  expect(fetch).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
  expect(liveContext).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(heard).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "播放試聽" }));
  await waitFor(() => expect(heard).toHaveBeenCalledOnce());
  expect(liveContext).toHaveBeenCalledOnce();
  expect(resume).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(decode).toHaveBeenCalledOnce();
});

test("revealing during preload never starts late audio or unlocks guessing", async () => {
  let finish;
  decode.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const heard = vi.fn();
  const { rerender } = render(
    <PreviewPlayer song={song} limit={1} onPlaybackStarted={heard} />,
  );
  await waitFor(() => expect(finish).toBeDefined());
  rerender(
    <PreviewPlayer song={song} revealed limit={1} onPlaybackStarted={heard} />,
  );
  await act(async () => finish({ duration: 30 }));
  expect(create).not.toHaveBeenCalled();
  expect(heard).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "播放試聽" })).toBeEnabled();
});

test("a failed preload has a retry that prepares without playing", async () => {
  fetch.mockRejectedValueOnce(new Error("network"));
  const heard = vi.fn();
  render(<PreviewPlayer song={song} limit={1} onPlaybackStarted={heard} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "重新載入試聽" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "播放試聽" })).toBeEnabled(),
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(create).not.toHaveBeenCalled();
  expect(heard).not.toHaveBeenCalled();
});

test("replacing a song aborts old preload and ignores its late decoded duration", async () => {
  let finish;
  decode
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ duration: 8 });
  const duration = vi.fn();
  const { rerender } = render(
    <PreviewPlayer song={song} revealed onDuration={duration} />,
  );
  await waitFor(() => expect(finish).toBeDefined());
  const signal = fetch.mock.calls[0][1].signal;
  rerender(
    <PreviewPlayer
      song={{ ...song, preview: `${song.preview}?next` }}
      revealed
      onDuration={duration}
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "8"),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ duration: 90 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "8");
  expect(duration).toHaveBeenCalledExactlyOnceWith(8);
});

test("answer content follows playback and the player has no duplicate Apple Music link", async () => {
  const { container } = render(
    <PreviewPlayer song={song} revealed>
      <h2>歌曲答案</h2>
    </PreviewPlayer>,
  );
  await screen.findByRole("button", { name: "播放試聽" });
  const answer = screen.getByRole("heading", { name: "歌曲答案" });
  expect(answer.previousElementSibling).toHaveClass("playback");
  expect(container.querySelector(".source-credit").previousElementSibling).toBe(
    answer,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
