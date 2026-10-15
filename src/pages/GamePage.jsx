import LoadingState from "../components/LoadingState.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { readPlayerName, savePlayerName } from "../lib/player-name.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  InfinityIcon,
  VinylRecordIcon,
  QuestionIcon,
} from "@phosphor-icons/react";
import { filterPool, decadeLabels, songKey } from "../lib/game-logic.js";
import { appleURL, request, cachedResponse } from "../lib/api.js";
import GuessInput from "../components/GuessInput.jsx";
import PreviewPlayer from "../components/PreviewPlayer.jsx";
import Turntable from "../components/Turntable.jsx";
import SoloResults from "../components/SoloResults.jsx";
import "./solo.css";

const activeRunKey = "music-challenge-active-run";
function storedRun() {
  try {
    return sessionStorage.getItem(activeRunKey);
  } catch {
    return null;
  }
}
function rememberRun(id) {
  try {
    id
      ? sessionStorage.setItem(activeRunKey, id)
      : sessionStorage.removeItem(activeRunKey);
  } catch {
    /* Private browsing can disallow storage. */
  }
}
function Choices({ label, options, value, onChange, disabled }) {
  return (
    <fieldset className="solo-choices" disabled={disabled}>
      <legend>{label}</legend>
      <div>
        {Object.entries(options).map(([key, text]) => (
          <button
            type="button"
            key={key}
            aria-pressed={value === key}
            className={value === key ? "selected" : ""}
            onClick={() => onChange(key)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
export default function GamePage() {
  const { setGameActive, showHelp } = useOutletContext() || {};
  const [catalog, setCatalog] = useState(
      () => cachedResponse("/api/catalog") || [],
    ),
    [nickname, setNickname] = useState(() => readPlayerName()),
    [player, setPlayer] = useState(() => cachedResponse("/api/player") || null);
  const [region, setRegion] = useState("kr"),
    [category, setCategory] = useState("all"),
    [decade, setDecade] = useState("all"),
    [mode, setMode] = useState("classic");
  const [setupStep, setSetupStep] = useState(0),
    [run, setRun] = useState(null);
  const [loading, setLoading] = useState(
      () =>
        !!storedRun() ||
        !cachedResponse("/api/catalog") ||
        !cachedResponse("/api/player"),
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(false),
    busy = useRef(false),
    runRef = useRef(null),
    duration = useRef(0),
    heardRound = useRef(null);
  const pool = useMemo(
    () => [
      ...new Map(
        filterPool(
          catalog,
          run?.settings.region ?? region,
          run?.settings.category ?? category,
          run?.settings.decade ?? decade,
        ).map((song) => [songKey(song), song]),
      ).values(),
    ],
    [
      catalog,
      run?.settings.region,
      run?.settings.category,
      run?.settings.decade,
      region,
      category,
      decade,
    ],
  );
  const classicRounds = Math.min(5, pool.length);
  const gameActive = !!run && run.status !== "finished";
  useEffect(() => {
    setGameActive?.(gameActive);
    return () => setGameActive?.(false);
  }, [gameActive, setGameActive]);
  function accept(next) {
    runRef.current = next;
    setRun(next);
    rememberRun(next.status === "finished" ? null : next.id);
  }
  async function load(signal) {
    setLoading(
      !!storedRun() ||
        !cachedResponse("/api/catalog") ||
        !cachedResponse("/api/player"),
    );
    setError("");
    try {
      const [songs, guest] = await Promise.all([
        request("/api/catalog", { signal }),
        request("/api/player", { signal }),
      ]);
      if (!alive.current || signal?.aborted) return;
      setCatalog(songs);
      setPlayer(guest);
      const savedName = readPlayerName(guest.nickname || "");
      savePlayerName(savedName);
      setNickname(savedName);
      const saved = storedRun();
      if (saved) {
        try {
          const previous = await request(
            `/api/runs/${encodeURIComponent(saved)}`,
            { signal },
          );
          if (alive.current && !signal?.aborted) accept(previous);
        } catch (err) {
          if (err.name === "AbortError") throw err;
          if ([403, 404, 410].includes(err.status)) rememberRun(null);
          else throw err;
        }
      }
    } catch (err) {
      if (alive.current && err.name !== "AbortError")
        setError(err.message || "連線失敗，請再試一次。");
    } finally {
      if (alive.current && !signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);
  async function action(name, body = {}) {
    if (busy.current || !runRef.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    const current = runRef.current;
    try {
      const next = await request(`/api/runs/${current.id}/${name}`, {
        method: "POST",
        body: JSON.stringify({ revision: current.revision, ...body }),
      });
      if (alive.current) accept(next);
      return next;
    } catch (err) {
      if (alive.current) {
        setError(err.message || "操作失敗，請再試一次。");
        // A lost response may already have changed the server. Recover without
        // resending a scored action, which could otherwise count twice.
        try {
          const latest = await request(`/api/runs/${current.id}`);
          if (alive.current) accept(latest);
        } catch {
          /* Keep the actionable error and current view. */
        }
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function start() {
    if (busy.current || !nickname.trim()) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (nickname.trim() !== player?.nickname) {
        const guest = await request("/api/player", {
          method: "PATCH",
          body: JSON.stringify({ nickname: nickname.trim() }),
        });
        if (alive.current) setPlayer(guest);
      }
      const next = await request("/api/runs", {
        method: "POST",
        body: JSON.stringify({ mode, region, category, decade }),
      });
      if (alive.current) {
        duration.current = 0;
        heardRound.current = null;
        accept(next);
      }
    } catch (err) {
      if (alive.current) setError(err.message || "無法開始挑戰，請再試一次。");
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function beganPlayback(playback) {
    const current = runRef.current;
    if (
      !current ||
      current.heard ||
      current.status !== "playing" ||
      heardRound.current === current.preview?.id
    )
      return;
    heardRound.current = current.preview?.id;
    const updated = await action("play", {
      duration: playback?.duration || duration.current || 30,
    });
    if (!updated) heardRound.current = null;
  }
  function home() {
    rememberRun(null);
    runRef.current = null;
    setRun(null);
    setSetupStep(0);
    setError("");
  }
  async function advance() {
    duration.current = 0;
    heardRound.current = null;
    await action("next");
  }
  const statusMessage = error || (loading ? "正在準備題庫…" : "");
  if (loading && !run) return <LoadingState label="正在準備題庫…" />;
  if (!run)
    return (
      <section
        className="solo-screen solo-home"
        aria-labelledby="solo-home-title"
      >
        <div className="solo-home-heading">
          <div className="solo-home-record">
            <Turntable playing decorative />
          </div>
          <div>
            <p className="solo-kicker">PRESS PLAY. TAKE THE CHALLENGE.</p>
            <h1 id="solo-home-title">一秒，聽出你的歌。</h1>
            <p>按播放聽一段，用最少提示拿高分。</p>
          </div>
        </div>
        <div className="solo-setup">
          <div className="solo-step-heading">
            <span>選擇你的挑戰</span>
            <span aria-label={`設定第 ${setupStep + 1} 步，共 2 步`}>
              0{setupStep + 1} / 02
            </span>
          </div>
          {setupStep === 0 ? (
            <>
              <div className="solo-name">
                <label htmlFor="player-nickname">排行榜暱稱</label>
                <input
                  id="player-nickname"
                  type="text"
                  maxLength={20}
                  value={nickname}
                  onChange={(event) => {
                    savePlayerName(event.target.value);
                    setNickname(event.target.value);
                  }}
                  placeholder="取個大家記得的名字"
                  autoComplete="nickname"
                  disabled={loading || pending}
                />
              </div>
              <div
                className="solo-mode-options"
                role="group"
                aria-label="挑戰模式"
              >
                <button
                  className={mode === "classic" ? "selected" : ""}
                  aria-pressed={mode === "classic"}
                  onClick={() => setMode("classic")}
                  disabled={loading || pending}
                >
                  <VinylRecordIcon />
                  <strong>經典挑戰</strong>
                  <span>最多 5 首，衝最高分</span>
                </button>
                <button
                  className={mode === "endless" ? "selected" : ""}
                  aria-pressed={mode === "endless"}
                  onClick={() => setMode("endless")}
                  disabled={loading || pending}
                >
                  <InfinityIcon />
                  <strong>無限挑戰</strong>
                  <span>一首接一首，隨時結算</span>
                </button>
              </div>
              <Choices
                label="曲庫"
                options={{ tw: "華語", kr: "K-POP" }}
                value={region}
                onChange={setRegion}
                disabled={loading || pending}
              />
              <button
                className="primary solo-primary"
                disabled={loading || pending || !nickname.trim()}
                onClick={() => setSetupStep(1)}
              >
                下一步：選擇歌曲 <ArrowRightIcon />
              </button>
            </>
          ) : (
            <>
              <p className="solo-settings-summary">
                {mode === "classic" ? `經典 ${classicRounds} 首` : "無限挑戰"} ·{" "}
                {region === "tw" ? "華語" : "K-POP"}
              </p>
              <Choices
                label="聲音"
                options={{
                  all: "不限",
                  boy: "男聲／男團",
                  girl: "女聲／女團",
                }}
                value={category}
                onChange={setCategory}
                disabled={pending}
              />
              <Choices
                label="年代"
                options={decadeLabels}
                value={decade}
                onChange={setDecade}
                disabled={pending}
              />
              <div className="solo-setup-actions">
                <button
                  className="text-button"
                  onClick={() => setSetupStep(0)}
                  disabled={pending}
                >
                  <ArrowLeftIcon />
                  上一步
                </button>
                <button
                  className="primary solo-primary"
                  onClick={start}
                  disabled={pending || !pool.length}
                >
                  {pending ? "準備開始…" : "開始猜歌"}
                  <ArrowUpRightIcon />
                </button>
              </div>
              {!pool.length && (
                <p className="solo-pool-note">
                  這個分類暫時沒有歌曲，試試其他選項。
                </p>
              )}
            </>
          )}
          <p className="solo-message" role={error ? "alert" : "status"}>
            {statusMessage}
          </p>
          {error && (
            <button className="text-button" onClick={() => load()}>
              重新載入題庫
            </button>
          )}
        </div>
      </section>
    );
  if (run.status === "finished")
    return (
      <SoloResults key={run.id} run={run} onRestart={home} error={error} />
    );
  const revealed = run.status === "revealed",
    song = run.answer || run.preview;
  return (
    <section
      className={`solo-screen solo-game ${revealed ? "is-revealed" : ""}`}
      aria-labelledby={revealed ? "solo-answer-title" : "solo-question-title"}
    >
      <div className="solo-game-top">
        <div className="solo-game-heading">
          <button
            className="text-button solo-finish"
            onClick={() => action("finish")}
            disabled={pending}
          >
            結束挑戰
          </button>
          <span className="solo-round">
            {run.mode === "endless" ? "∞" : "TRACK"}{" "}
            {String(run.round).padStart(2, "0")}
            {run.totalRounds
              ? ` / ${String(run.totalRounds).padStart(2, "0")}`
              : ""}
          </span>
          <div className="solo-score-tools">
            <strong className="solo-header-score">
              {run.score.toLocaleString()}
              <small> 分</small>
            </strong>
          </div>
        </div>
        <div className="solo-game-help-row">
          <button
            className="game-help"
            aria-label="玩法說明"
            onClick={showHelp}
          >
            <QuestionIcon />
          </button>
        </div>
      </div>
      <div className="solo-game-body">
        <PreviewPlayer
          key={run.preview.id}
          song={song}
          revealed={revealed}
          limit={run.clipSeconds}
          fullDuration={run.duration}
          aboveRecord={
            <div
              className="solo-stage-score"
              aria-label={`累積 ${run.score.toLocaleString()} 分`}
            >
              <span>累積分數</span>
              <strong>
                {run.score.toLocaleString()}
                <small> 分</small>
              </strong>
            </div>
          }
          stagePoints={run.points}
          wrongGuesses={run.wrongGuesses}
          onPlaybackStarted={beganPlayback}
          onDuration={(value) => {
            duration.current = value;
          }}
          onExtend={() => action("extend")}
          canExtend={
            run.canExtend ??
            (!revealed &&
              run.stage < 5 &&
              run.clipSeconds < (run.duration || duration.current || 30))
          }
          extendDisabled={pending || !run.heard}
          disabled={pending}
        >
          {revealed && (
            <div className="solo-answer-heading" aria-live="polite">
              <p className="solo-verdict">
                {run.lastResult?.correct
                  ? `答對了！ +${run.lastResult.points.toLocaleString()} 分`
                  : "答案揭曉 · 0 分"}
              </p>
              <h2 id="solo-answer-title">{song.title}</h2>
              <p className="solo-artist">{song.artist}</p>
            </div>
          )}
        </PreviewPlayer>
        <div className="solo-question">
          {!revealed ? (
            <>
              <h2 id="solo-question-title" className="sr-only">
                猜猜這首歌
              </h2>
              <p className="solo-feedback" role="status">
                {run.feedback ||
                  (run.heard ? "搜尋歌名或歌手，選取後送出" : "按播放，聽完再猜")}
              </p>
              <GuessInput
                key={`${run.preview.id}-${run.stage}`}
                songs={pool}
                onGuess={(guess) =>
                  action("guess", {
                    answer: guess.text,
                    ...(guess.song ? { songId: guess.song.id } : {}),
                  })
                }
                disabled={pending || !run.heard}
              />
              <button
                className="text-button solo-reveal"
                onClick={() => action("reveal")}
                disabled={pending}
              >
                不知道，揭曉答案
              </button>
            </>
          ) : (
            <div className="solo-answer solo-answer-actions">
              <a
                className="apple-link"
                href={appleURL(song)}
                target="_blank"
                rel="noopener noreferrer"
              >
                在 Apple Music 聆聽
                <ArrowUpRightIcon />
              </a>
              <button
                className="primary solo-primary"
                onClick={advance}
                disabled={pending}
              >
                {pending
                  ? "準備中…"
                  : run.totalRounds && run.round >= run.totalRounds
                    ? "看看本輪成績"
                    : "下一首"}
                <ArrowRightIcon />
              </button>
            </div>
          )}
          <p className="solo-message" role="alert">
            {error}
          </p>
        </div>
      </div>
    </section>
  );
}
