import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react";
import {
  filterPool,
  isCorrectGuess,
  pointsForTime,
  decadeLabels,
} from "../lib/game-logic.js";
import { appleURL, request } from "../lib/api.js";
import GuessInput from "../components/GuessInput.jsx";
import PreviewPlayer from "../components/PreviewPlayer.jsx";
import ChallengeClock from "../components/ChallengeClock.jsx";

const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};
const emptyGame = {
  screen: "home",
  rounds: [],
  pool: [],
  index: 0,
  history: [],
  verdict: null,
};
export default function GamePage() {
  const [catalog, setCatalog] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [region, setRegion] = useState("kr"),
    [mix, setMix] = useState("all"),
    [decade, setDecade] = useState("all"),
    [game, setGame] = useState(emptyGame);
  const clockStart = useRef(null);
  const [startedAt, setStartedAt] = useState(null);
  function resetClock() {
    clockStart.current = null;
    setStartedAt(null);
  }
  function beginClock() {
    if (clockStart.current !== null || game.verdict) return;
    clockStart.current = performance.now();
    setStartedAt(clockStart.current);
  }
  const busy = useRef(false),
    mounted = useRef(false),
    next = useRef(null);
  const pool = useMemo(
    () => filterPool(catalog, region, mix, decade),
    [catalog, region, mix, decade],
  );
  const artists = useMemo(
    () => [...new Set(pool.map((s) => s.artist))],
    [pool],
  );
  const correctCount = game.history.filter((h) => h.correct).length;
  const score = game.history.reduce((sum, h) => sum + h.points, 0);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    request("/api/catalog", { signal: controller.signal })
      .then(setCatalog)
      .catch((err) => {
        if (err.name !== "AbortError")
          setError("題庫載入失敗，請確認網路連線後重試。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [game.screen]);
  useEffect(() => {
    if (game.verdict) next.current?.focus({ preventScroll: true });
  }, [game.verdict]);
  async function start() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const songs = await request("/api/catalog");
      if (!mounted.current) return;
      setCatalog(songs);
      const current = filterPool(songs, region, mix, decade);
      if (current.length >= 5) {
        resetClock();
        setGame({
          ...emptyGame,
          screen: "game",
          rounds: shuffle(current).slice(0, 5),
          pool: current,
        });
      }
    } catch {
      if (mounted.current) setError("題庫載入失敗，請確認網路連線後重試。");
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }
  function reveal(guess) {
    if (guess !== null && clockStart.current === null) return;
    const elapsedMs =
      clockStart.current === null
        ? null
        : Math.max(0, performance.now() - clockStart.current);
    setGame((current) => {
      if (current.verdict || current.screen !== "game") return current;
      const song = current.rounds[current.index],
        skipped = guess === null,
        correct = !skipped && isCorrectGuess(song, guess.text, guess.song);
      const verdict = {
        song,
        correct,
        skipped,
        elapsedMs,
        points: correct ? pointsForTime(elapsedMs) : 0,
      };
      return { ...current, verdict, history: [...current.history, verdict] };
    });
  }
  function advance() {
    if (!game.verdict) return;
    resetClock();
    setGame((current) =>
      !current.verdict
        ? current
        : {
            ...current,
            screen: current.index === 4 ? "results" : "game",
            index: current.index === 4 ? 4 : current.index + 1,
            verdict: null,
          },
    );
  }
  if (game.screen === "home")
    return (
      <section id="home" aria-labelledby="home-title">
        <div className="hero">
          <div className="hero-copy">
            <p className="eyebrow">FOR THE FANS. FOR THE MUSIC.</p>
            <h1 id="home-title">
              前奏一響，
              <br />
              你的本命藏不住。
            </h1>
            <p className="intro">
              華語金曲、K-POP 熱歌，測測你的音樂雷達。
              <br />
              從熟悉的旋律，找到下一首單曲循環。
            </p>
            <div className="setup">
              <span className="field-label" id="region-label">
                今天想挑戰哪一種？
              </span>
              <div
                className="regions"
                role="group"
                aria-labelledby="region-label"
              >
                {Object.entries({
                  tw: "華語",
                  kr: "K-POP",
                }).map(([value, label]) => (
                  <button
                    key={value}
                    className={`region ${region === value ? "active" : ""}`}
                    aria-pressed={region === value}
                    onClick={() => setRegion(value)}
                    disabled={loading}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="field-label" id="mix-label">
                再挑一種聲音
              </span>
              <div className="mixes" role="group" aria-labelledby="mix-label">
                {Object.entries({
                  all: "男女合併",
                  girl: "女聲／女團",
                  boy: "男聲／男團",
                }).map(([value, label]) => (
                  <button
                    key={value}
                    className={`mix ${mix === value ? "active" : ""}`}
                    aria-pressed={mix === value}
                    onClick={() => setMix(value)}
                    disabled={loading}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="field-label" id="decade-label">挑個年代</span>
              <div className="mixes decades" role="group" aria-labelledby="decade-label">
                {Object.entries(decadeLabels).map(([value, label]) => (
                  <button key={value} className={`mix ${decade === value ? "active" : ""}`}
                    aria-pressed={decade === value} onClick={() => setDecade(value)} disabled={loading}>
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="primary start-button"
                onClick={start}
                disabled={loading || (!error && pool.length < 5)}
              >
                {loading
                  ? "準備題庫中…"
                  : error
                    ? "重新載入題庫"
                    : pool.length >= 5
                      ? "開始猜歌"
                      : "歌曲準備中"}
                <ArrowUpRightIcon aria-hidden="true" />
              </button>
              <p className="small muted" role="status">
                {error ||
                  (loading
                    ? "正在連接你的音樂宇宙"
                    : !catalog.length
                      ? "新歌即將開放，敬請期待。"
                      : pool.length < 5
                        ? "這個分類的歌曲尚未準備齊全，請選擇其他分類或稍後再來。"
                        : `${pool.length} 首精選，每輪 5 題，不需登入`)}
              </p>
            </div>
          </div>
          <div className="hero-visual">
            <img
              src="/images/record-hero.webp"
              alt="玫紅唱片封套與黑膠唱片"
              width="1254"
              height="1254"
              fetchPriority="high"
            />
          </div>
        </div>
        <div className="how-strip">
          <div>
            <p>
              聽一段旋律<small>Apple 提供的歌曲試聽</small>
            </p>
          </div>
          <div>
            <p>
              搶先猜中答案<small>1 秒內 1,000 分，越快分數越高</small>
            </p>
          </div>
          <div>
            <p>
              把好歌帶回去<small>揭曉後前往 Apple Music</small>
            </p>
          </div>
        </div>
        <section className="rotation">
          <div className="rotation-heading">
            <h2>今天的聲音宇宙</h2>
          </div>
          <div className="artist-list">
            {artists.map((artist) => (
              <div key={artist} className="artist-chip">
                {artist}
                <small>
                  {pool.filter((s) => s.artist === artist).length} tracks
                </small>
              </div>
            ))}
          </div>
        </section>
      </section>
    );
  if (game.screen === "results")
    return (
      <section id="results" aria-labelledby="results-title">
        <div className="results-top">
          <h1 id="results-title">
            {correctCount === 5
              ? "全中！你就是人形歌單。"
              : correctCount >= 3
                ? "你的音樂雷達，很靈。"
                : "新歌單，已經有了靈感。"}
          </h1>
          <p className="muted">
            本輪獲得 {score} 分。每一次聆聽，都離喜歡的音樂更近一點。
          </p>
          <div className="final-score">
            <strong>{score.toLocaleString()}</strong>
            <span>/ 5,000 分 · {correctCount} / 5 首猜中</span>
          </div>
          <button className="primary" onClick={() => setGame(emptyGame)}>
            再聽一輪 <ArrowUpRightIcon />
          </button>
        </div>
        <div className="results-heading">
          <h2>這一輪，值得再聽一次。</h2>
          <p className="muted">喜歡的旋律，去 Apple Music 繼續聽。</p>
        </div>
        <div className="song-history">
          {game.history.map(({ song, correct, skipped, points, elapsedMs }) => (
            <div key={song.id} className="history-row">
              <img
                src={song.artwork}
                alt={`${song.album} 專輯封面`}
                width="62"
                height="62"
              />
              <div className="history-info">
                <strong>{song.title}</strong>
                <p>
                  {song.artist} · {song.year}
                </p>
              </div>
              <span className={`history-status ${correct ? "" : "skipped"}`}>
                {correct
                  ? `+${points.toLocaleString()} 分 · ${(elapsedMs / 1000).toFixed(2)} 秒`
                  : skipped
                    ? "已揭曉"
                    : "答錯 · 0 分"}
              </span>
              <a
                href={appleURL(song)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`在 Apple Music 聆聽 ${song.title}`}
              >
                Apple Music <ArrowUpRightIcon />
              </a>
            </div>
          ))}
        </div>
      </section>
    );
  const song = game.rounds[game.index],
    verdict = game.verdict;
  return (
    <section
      id="game"
      aria-labelledby={verdict ? "answer-title" : "question-title"}
    >
      <div className="game-heading">
        <button className="text-button" onClick={() => setGame(emptyGame)}>
          <ArrowLeftIcon /> 回到選曲
        </button>
        <span>TRACK {String(game.index + 1).padStart(2, "0")} / 05</span>
        <span className="score-label">
          得分 <b>{score.toLocaleString()}</b>
        </span>
      </div>
      <div
        className="round-track"
        aria-label={`第 ${game.index + 1} 題，共 5 題`}
      >
        {game.rounds.map((s, i) => (
          <span
            key={s.id}
            className={`round-mark ${i === game.index ? "current" : i < game.index ? "done" : ""}`}
          />
        ))}
      </div>
      <div className="game-layout">
        <PreviewPlayer
          key={song.id}
          song={song}
          revealed={!!verdict}
          onPlaybackStarted={beginClock}
        />
        <div className="question-panel">
          {!verdict ? (
            <div>
              <h2 id="question-title">猜猜這首歌</h2>
              <ChallengeClock key={`clock-${song.id}`} startedAt={startedAt} />
              <GuessInput
                key={song.id}
                songs={game.pool}
                onGuess={reveal}
                disabled={startedAt === null}
              />
              <button className="text-button skip" onClick={() => reveal(null)}>
                直接揭曉 <ArrowRightIcon />
              </button>
            </div>
          ) : (
            <div aria-live="polite">
              <p className="verdict">
                {verdict.correct
                  ? `答對了！ +${verdict.points.toLocaleString()} 分`
                  : verdict.skipped
                    ? "答案揭曉"
                    : "答錯了 · 0 分"}
              </p>
              {verdict.elapsedMs !== null && (
                <p className="answer-time">
                  作答時間 {(verdict.elapsedMs / 1000).toFixed(2)} 秒
                  {!verdict.correct && " · 本題 0 分"}
                </p>
              )}
              <h2 id="answer-title">{song.title}</h2>
              <p className="answer-artist">{song.artist}</p>
              <p className="muted album-detail">
                {song.album} · {song.year}
              </p>
              <a
                className="apple-link"
                href={appleURL(song)}
                target="_blank"
                rel="noopener noreferrer"
              >
                在 Apple Music 聆聽 <ArrowUpRightIcon />
              </a>
              <button ref={next} className="primary next" onClick={advance}>
                {game.index === 4 ? "看看本輪成績" : "下一首"}
                <ArrowRightIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
