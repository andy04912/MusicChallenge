import { useEffect, useRef, useState } from "react";
import { PlayIcon, PauseIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { ClipAudio } from "../lib/clip-audio.js";
import Turntable from "./Turntable.jsx";

export default function PreviewPlayer({
  song,
  revealed,
  limit = 1,
  fullDuration = 30,
  onPlaybackStarted,
  onDuration,
  stagePoints,
  onExtend,
  canExtend = false,
  extendDisabled = false,
  disabled = false,
  children,
  aboveRecord,
  wrongGuesses = [],
}) {
  const engine = useRef(null),
    progress = useRef(null),
    position = useRef(null),
    playButton = useRef(null);
  const callbacks = useRef({ onPlaybackStarted, onDuration });
  callbacks.current = { onPlaybackStarted, onDuration };
  const generation = useRef(0);
  const [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [duration, setDuration] = useState(0);
  const [preparation, setPreparation] = useState("loading");
  const clipEnd = revealed
    ? duration || fullDuration || 30
    : Math.min(limit, duration || limit);
  useEffect(() => {
    const player = new ClipAudio(song.preview, setPlaying);
    engine.current = player;
    setDuration(0);
    void prepare(player);
    const pause = () => {
      if (document.hidden) {
        generation.current++;
        player.pause();
        setLoading(false);
      }
    };
    document.addEventListener("visibilitychange", pause);
    playButton.current?.focus({ preventScroll: true });
    return () => {
      generation.current++;
      player.onState = () => {};
      player.dispose();
      document.removeEventListener("visibilitychange", pause);
    };
  }, [song.preview]);
  async function prepare(player = engine.current) {
    if (!player || player.disposed) return;
    setPreparation("loading");
    setError("");
    try {
      const result = await player.preload();
      if (!result || engine.current !== player || player.disposed) return;
      if (result.duration > 0) {
        setDuration(result.duration);
        callbacks.current.onDuration?.(result.duration);
      }
      setPreparation("ready");
    } catch {
      if (engine.current === player && !player.disposed) {
        setPreparation("error");
        setError("試聽準備失敗，請重新載入或揭曉答案。");
      }
    }
  }
  async function start(seconds) {
    const id = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await engine.current.play(seconds);
      if (!result || id !== generation.current) return;
      setDuration(result.duration);
      callbacks.current.onDuration?.(result.duration);
      if (!revealed) await callbacks.current.onPlaybackStarted?.(result);
    } catch {
      if (id === generation.current)
        setError("試聽載入失敗，請重試或直接揭曉。");
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    generation.current++;
    engine.current?.pause();
    setLoading(false);
    if (progress.current) progress.current.value = 0;
    if (position.current) position.current.textContent = "0.0";
  }, [limit, revealed]);
  useEffect(() => {
    if (!playing) {
      const value = engine.current?.position || 0;
      if (progress.current) progress.current.value = value;
      if (position.current) position.current.textContent = value.toFixed(1);
      return;
    }
    let frame;
    const tick = () => {
      const value = engine.current?.position || 0;
      if (progress.current) progress.current.value = value;
      if (position.current) position.current.textContent = value.toFixed(1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  function toggle() {
    if (loading || engine.current?.playing) {
      generation.current++;
      engine.current?.pause();
      setLoading(false);
    } else void start(revealed ? Infinity : limit);
  }
  return (
    <div
      className="listen-panel"
      style={{
        "--wrong-guesses-height": `${wrongGuesses.length ? wrongGuesses.length * 22 + 8 : 0}px`,
        "--compact-wrong-guesses-height": `${wrongGuesses.length ? Math.ceil(wrongGuesses.length / 2) * 22 + 8 : 0}px`,
      }}
    >
      {aboveRecord}
      <Turntable
        playing={playing}
        loading={preparation === "loading" || loading}
        artwork={revealed ? song.artwork : null}
      />
      <div className="playback">
        <button
          ref={playButton}
          className="play-button"
          aria-label={
            preparation === "loading"
              ? "正在準備試聽"
              : loading
                ? "取消載入"
                : playing
                  ? "暫停試聽"
                  : "播放試聽"
          }
          onClick={toggle}
          disabled={disabled || preparation !== "ready"}
          aria-busy={preparation === "loading" || loading}
        >
          {playing || loading ? (
            <PauseIcon weight="fill" />
          ) : (
            <PlayIcon weight="fill" />
          )}
          <span>
            {preparation === "loading"
              ? "準備中"
              : loading
                ? "載入中"
                : playing
                  ? "暫停"
                  : "播放"}
          </span>
        </button>
        <div className="playback-details">
          <span>
            {loading ? (
              "正在載入試聽…"
            ) : revealed ? (
              "完整試聽"
            ) : (
              <>
                <strong className="clip-score">
                  {Number(clipEnd.toFixed(1))} 秒
                  {Number.isFinite(stagePoints) && (
                    <>
                      {" "}
                      · <b>{stagePoints.toLocaleString()}</b> 分
                    </>
                  )}
                </strong>
              </>
            )}
          </span>
          <progress
            ref={progress}
            className="preview-progress"
            value={0}
            max={clipEnd || 1}
            aria-label="已解鎖片段播放進度"
          />
          <span className="audio-time">
            <span ref={position}>0.0</span> / {Number(clipEnd.toFixed(1))} 秒
          </span>
          {!revealed && onExtend && (
            <button
              type="button"
              className="extend-button"
              onClick={onExtend}
              disabled={extendDisabled || disabled || !canExtend}
            >
              <PlusIcon aria-hidden="true" />{" "}
              {canExtend ? "延長片段" : "完整片段"}
            </button>
          )}
        </div>
      </div>
      {children}
      {error && (
        <p className="audio-error" role="status">
          {error}
        </p>
      )}
      {preparation === "error" && (
        <button className="text-button audio-retry" onClick={() => prepare()}>
          重新載入試聽
        </button>
      )}
      <div className="source-credit">
        <p className="courtesy">Song preview provided courtesy of iTunes</p>
        {wrongGuesses.length > 0 && (
          <ul
            className="wrong-guesses"
            aria-label="本題猜錯紀錄"
            aria-live="polite"
          >
            {wrongGuesses.map((title, index) => (
              <li key={index}>
                <XIcon weight="bold" aria-hidden="true" />
                <span title={title}>{title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
