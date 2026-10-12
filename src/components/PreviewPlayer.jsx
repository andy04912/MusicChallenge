import { useEffect, useRef, useState } from "react";
import { PlayIcon, PauseIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { appleURL } from "../lib/api.js";
const seconds = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export default function PreviewPlayer({ song, revealed, onPlaybackStarted }) {
  const audio = useRef(null),
    play = useRef(null),
    request = useRef(0);
  const [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [time, setTime] = useState({ current: 0, duration: 0 });
  useEffect(() => {
    const player = audio.current;
    player.src = song.preview;
    const pause = () => {
      if (document.hidden) player.pause();
    };
    document.addEventListener("visibilitychange", pause);
    play.current?.focus({ preventScroll: true });
    return () => {
      request.current++;
      player.pause();
      player.removeAttribute("src");
      player.load();
      document.removeEventListener("visibilitychange", pause);
    };
  }, []);
  useEffect(() => {
    if (revealed) {
      audio.current.pause();
      setPlaying(false);
    }
  }, [revealed]);
  async function toggle() {
    const player = audio.current;
    if (!player.paused) {
      player.pause();
      return;
    }
    const current = ++request.current;
    setLoading(true);
    setError("");
    if (player.ended) player.currentTime = 0;
    try {
      await player.play();
    } catch {
      if (current === request.current)
        setError(
          "暫時無法播放，可能是網路或地區限制。請再試一次，或直接揭曉歌曲。",
        );
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  return (
    <div className="listen-panel">
      <div
        className={`turntable ${playing ? "is-playing" : ""}`}
        role="img"
        aria-label={
          playing ? "粉紅唱片盤，黑膠唱片旋轉中" : "粉紅唱片盤，黑膠唱片已暫停"
        }
      >
        <span className="deck-brand" aria-hidden="true">
          seoul ✳ signal
        </span>
        <div className="vinyl-record" aria-hidden="true">
          <div className="disc-label">
            {revealed && song.artwork ? (
              <img src={song.artwork} alt="" />
            ) : (
              <>
                <span>✳</span>
                <small>SEOUL SIGNAL</small>
              </>
            )}
          </div>
        </div>
        <span className="tonearm" aria-hidden="true" />
        <span className="deck-status" aria-hidden="true">
          {playing ? "NOW SPINNING" : "READY TO PLAY"}
        </span>
      </div>
      <audio
        ref={audio}
        src={song.preview}
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          setLoading(false);
          onPlaybackStarted?.();
        }}
        onWaiting={() => setPlaying(false)}
        onStalled={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const a = event.currentTarget;
          if (Number.isFinite(a.duration))
            setTime({ current: a.currentTime, duration: a.duration });
        }}
        onError={() => {
          setError(
            "此片段目前無法載入，請重試或直接揭曉，再前往 Apple Music 聆聽。",
          );
          setLoading(false);
          setPlaying(false);
        }}
      />
      <div className="playback">
        <button
          ref={play}
          className="play-button"
          aria-label={playing ? "暫停試聽" : "播放試聽"}
          onClick={toggle}
          disabled={loading}
        >
          {playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
        </button>
        <div className="playback-details">
          <span>
            {loading
              ? "正在載入試聽…"
              : playing
                ? "正在播放試聽"
                : "聽聽這首歌"}
          </span>
          <progress
            className="preview-progress"
            value={time.current}
            max={time.duration || 1}
            aria-label="試聽進度"
          />
          <span className="audio-time">
            {seconds(time.current)} /{" "}
            {time.duration ? seconds(time.duration) : "試聽片段"}
          </span>
        </div>
      </div>
      <div className="source-credit">
        <p className="courtesy">Song preview provided courtesy of iTunes</p>
        <a
          className="source-link"
          href={appleURL(song)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Apple Music <ArrowUpRightIcon aria-hidden="true" />
        </a>
      </div>
      {error && (
        <p className="audio-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
