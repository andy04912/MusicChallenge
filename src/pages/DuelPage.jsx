import { useEffect, useRef, useState } from "react";
import LoadingState from "../components/LoadingState.jsx";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router";
import {
  CheckIcon,
  CopyIcon,
  LinkIcon,
  UsersIcon,
  WifiSlashIcon,
  QuestionIcon,
} from "@phosphor-icons/react";
import { appleURL, request, cachedResponse } from "../lib/api.js";
import { readPlayerName, savePlayerName } from "../lib/player-name.js";
import { decadeLabels, filterPool } from "../lib/game-logic.js";
import {
  roomAction,
  roomPath,
  subscribeRoom,
  validRoomCode,
} from "../lib/room-client.js";
import PreviewPlayer from "../components/PreviewPlayer.jsx";
import GuessInput from "../components/GuessInput.jsx";
import ScoreRoll from "../components/ScoreRoll.jsx";
import ShareResultButton from "../components/ShareResultButton.jsx";
import "./duel.css";

const initialSettings = {
  mode: "classic",
  region: "kr",
  category: "all",
  decade: "all",
};
const labels = {
  classic: "5 首對決",
  endless: "無限對決",
  kr: "K-POP",
  tw: "華語",
  all: "不限",
  boy: "男聲",
  girl: "女聲",
  other: "男女合唱",
};
function acknowledgedEnd(key) {
  try {
    return !!key && sessionStorage.getItem(key) === "yes";
  } catch {
    return false;
  }
}
function SettingsLabel({ settings, mode }) {
  return (
    <p className="duel-settings-label">
      {labels[settings?.region]} · {labels[mode || settings?.mode]} ·{" "}
      {labels[settings?.category]} · {decadeLabels[settings?.decade]}
    </p>
  );
}
function Choice({ name, value, options, onChange }) {
  return (
    <div className="duel-choice">
      <span>{name}</span>
      <div role="group" aria-label={name}>
        {Object.entries(options).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={key === value}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <select
        aria-label={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {Object.entries(options).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
function PlayerStrip({ room }) {
  return (
    <div className="duel-players">
      {room.players?.map((player) => (
        <div
          key={player.id}
          className={player.id === room.me?.id ? "is-you" : ""}
        >
          <span className="duel-avatar" aria-hidden="true">
            {player.nickname?.slice(0, 1) || "♪"}
          </span>
          <span className="duel-player-name">
            {player.nickname}
            <small>
              {player.id === room.me?.id
                ? "你"
                : player.connected === false
                  ? "連線中斷"
                  : "對手"}
            </small>
          </span>
          <strong aria-label={`累積 ${player.score || 0} 分`}>
            {player.score?.toLocaleString() || 0}
          </strong>
          {player.done && (
            <CheckIcon className="duel-player-done" aria-label="已完成作答" />
          )}
        </div>
      ))}
    </div>
  );
}

export default function DuelPage() {
  const { setGameActive, showHelp } = useOutletContext() || {};
  const { code: pathCode } = useParams();
  const [search] = useSearchParams();
  const code = pathCode || search.get("room") || "";
  const navigate = useNavigate();
  const [room, setRoom] = useState(null),
    [catalog, setCatalog] = useState(
      () => cachedResponse("/api/catalog") || [],
    );
  const [nickname, setNickname] = useState(() => readPlayerName()),
    [settings, setSettings] = useState(initialSettings);
  const [loading, setLoading] = useState(
      () =>
        !!code ||
        !cachedResponse("/api/catalog") ||
        !cachedResponse("/api/player"),
    ),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [connected, setConnected] = useState(true);
  const [copied, setCopied] = useState(false),
    [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [endAcknowledged, setEndAcknowledged] = useState("");
  const [setupStep, setSetupStep] = useState(0);
  const leaveCancel = useRef(null);
  const leaveDialog = useRef(null);
  const leaveButton = useRef(null);
  const endedDialog = useRef(null),
    endedConfirm = useRef(null);
  const current = useRef(null),
    pending = useRef(false),
    duration = useRef(30),
    mounted = useRef(true);
  const stateRef = useRef(null);
  stateRef.current = room;
  const accept = (snapshot) => {
    if (!mounted.current || !snapshot) return;
    const previous = stateRef.current;
    if (
      previous?.code === snapshot.code &&
      previous.revision > snapshot.revision
    )
      return;
    stateRef.current = snapshot;
    setRoom(snapshot);
  };
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    setLoading(
      !!code ||
        !cachedResponse("/api/catalog") ||
        !cachedResponse("/api/player"),
    );
    setError("");
    setRoom(null);
    stateRef.current = null;
    const load = async () => {
      try {
        if (code && !validRoomCode(code))
          throw new Error("邀請連結不完整，請向朋友索取新的連結。");
        const player = await request("/api/player", { signal: abort.signal });
        if (abort.signal.aborted) return;
        setNickname(readPlayerName(player.nickname || ""));
        if (code)
          accept(await request(roomPath(code), { signal: abort.signal }));
        const songs = await request("/api/catalog", { signal: abort.signal });
        if (!abort.signal.aborted) setCatalog(songs);
      } catch (err) {
        if (!abort.signal.aborted) setError(err.message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [code]);
  const member = Boolean(room?.me);
  const gameActive = member && ["playing", "revealed"].includes(room?.status);
  const endAckKey =
    room?.endedBy && room.me
      ? `music-challenge-ended-${room.code}-${room.me.id}`
      : "";
  const opponentEnded =
    room?.status === "finished" &&
    room.endedBy &&
    room.me &&
    room.endedBy.id !== room.me.id &&
    endAcknowledged !== endAckKey &&
    !acknowledgedEnd(endAckKey);
  useEffect(() => {
    setGameActive?.(gameActive);
    return () => setGameActive?.(false);
  }, [gameActive, setGameActive]);
  useEffect(() => {
    if (!gameActive) return;
    const confirmNavigation = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmNavigation);
    return () => window.removeEventListener("beforeunload", confirmNavigation);
  }, [gameActive]);
  useEffect(() => {
    if (!code || !member || ["finished", "closed"].includes(room?.status))
      return;
    return subscribeRoom(code, accept, setConnected);
  }, [code, member, room?.status === "closed", room?.status === "finished"]);
  useEffect(() => {
    duration.current = 30;
    setLeaving(false);
  }, [room?.round]);
  useEffect(() => {
    const dialog = leaveDialog.current;
    if (leaving && dialog && !dialog.open) {
      dialog.showModal();
      leaveCancel.current?.focus({ preventScroll: true });
    } else if (!leaving && dialog?.open) {
      dialog.close();
      leaveButton.current?.focus({ preventScroll: true });
    }
  }, [leaving]);
  useEffect(() => {
    if (["closed", "finished"].includes(room?.status)) {
      setLeaving(false);
      setLeaveError("");
    }
  }, [room?.status]);
  useEffect(() => {
    const dialog = endedDialog.current;
    if (opponentEnded && dialog && !dialog.open) {
      leaveDialog.current?.close();
      dialog.showModal();
      endedConfirm.current?.focus({ preventScroll: true });
    } else if (!opponentEnded && dialog?.open) dialog.close();
  }, [opponentEnded]);
  function acknowledgeEnd() {
    try {
      sessionStorage.setItem(endAckKey, "yes");
    } catch {
      /* In-memory acknowledgment still works when storage is blocked. */
    }
    setEndAcknowledged(endAckKey);
  }
  function askToEnd() {
    setLeaveError("");
    setLeaving(true);
  }
  async function action(name, data = {}) {
    if (pending.current || !stateRef.current?.me) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      accept(await roomAction(stateRef.current, name, data));
      return true;
    } catch (err) {
      if (mounted.current) {
        if (name === "leave" || name === "finish") setLeaveError(err.message);
        else setError(err.message);
      }
      try {
        accept(await request(roomPath(code)));
      } catch {
        /* Keep the last snapshot for a reconnection attempt. */
      }
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function enter(create) {
    if (pending.current || !nickname.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    savePlayerName(nickname.trim());
    try {
      await request("/api/player", {
        method: "PATCH",
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
      const next = create
        ? await request("/api/rooms", {
            method: "POST",
            body: JSON.stringify(settings),
          })
        : await request(roomPath(code, "join"), { method: "POST", body: "{}" });
      if (!mounted.current) return;
      if (create) navigate(`/duel/${next.code}`, { replace: true });
      else accept(next);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const invite = code
    ? `${window.location.origin}/duel/${encodeURIComponent(code)}`
    : "";
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      current.current?.select();
      setError("請長按邀請連結，選擇複製後傳給朋友。");
    }
  }
  const me = room?.me,
    status = room?.status;
  const pool = room
    ? filterPool(
        catalog,
        room.settings?.region,
        room.settings?.category,
        room.settings?.decade,
      )
    : [];
  const title = !code
    ? "好友對戰"
    : status === "waiting"
      ? "等待你的對手"
      : status === "finished"
        ? "對戰結算"
        : status === "closed"
          ? "房間已關閉"
          : !me
            ? "朋友邀你對決"
            : `第 ${room.round} 首${room.totalRounds ? ` / ${room.totalRounds}` : ""}`;

  return (
    <section
      className={`duel-page duel-status-${status || "setup"}`}
      aria-labelledby="duel-title"
    >
      <header className="duel-header">
        <div>
          <p className="eyebrow">HEAD TO HEAD</p>
          <h1 id="duel-title">{title}</h1>
        </div>
        {me && !["closed", "finished"].includes(status) && (
          <button ref={leaveButton} className="duel-exit" onClick={askToEnd}>
            結束
          </button>
        )}
        {gameActive && showHelp && (
          <button
            className="game-help-button"
            aria-label="玩法說明"
            onClick={showHelp}
          >
            <QuestionIcon />
          </button>
        )}
      </header>
      {error && (
        <p className="duel-error" role="alert">
          {error}
        </p>
      )}
      {!connected && member && !["closed", "finished"].includes(status) && (
        <p className="duel-connection" role="status">
          <WifiSlashIcon /> 正在重新連線，進度已保留。
        </p>
      )}
      {loading ? (
        <LoadingState label="連接房間中…" />
      ) : !code ? (
        <form
          className="duel-setup"
          onSubmit={(event) => {
            event.preventDefault();
            if (setupStep === 0) setSetupStep(1);
            else void enter(true);
          }}
        >
          <p className="duel-intro">同一首歌，誰能用更短的片段猜中？</p>
          <div
            className="duel-step"
            aria-label={`設定步驟 ${setupStep + 1} / 2`}
          >
            <span className={setupStep === 0 ? "active" : ""}>
              01 身分與模式
            </span>
            <span className={setupStep === 1 ? "active" : ""}>02 選擇曲庫</span>
          </div>
          {setupStep === 0 ? (
            <>
              <label className="duel-nickname">
                你的暱稱
                <input
                  value={nickname}
                  onChange={(event) =>
                    setNickname(savePlayerName(event.target.value))
                  }
                  maxLength={20}
                  required
                  autoComplete="nickname"
                  placeholder="讓朋友認出你"
                />
              </label>
              <Choice
                name="對戰模式"
                value={settings.mode}
                options={{ classic: "5 首對決", endless: "無限對決" }}
                onChange={(mode) => setSettings({ ...settings, mode })}
              />
              <p className="duel-hint">
                兩人都答完才揭曉；準備好，再一起進入下一首。
              </p>
            </>
          ) : (
            <>
              <Choice
                name="曲庫"
                value={settings.region}
                options={{ tw: "華語", kr: "K-POP" }}
                onChange={(region) => setSettings({ ...settings, region })}
              />
              <Choice
                name="聲音"
                value={settings.category}
                options={{
                  all: "不限",
                  boy: "男聲",
                  girl: "女聲",
                  other: "男女合唱",
                }}
                onChange={(category) => setSettings({ ...settings, category })}
              />
              <Choice
                name="年代"
                value={settings.decade}
                options={decadeLabels}
                onChange={(decade) => setSettings({ ...settings, decade })}
              />
            </>
          )}
          <div className="duel-form-actions">
            {setupStep > 0 && (
              <button type="button" onClick={() => setSetupStep(0)}>
                上一步
              </button>
            )}
            <button
              className="primary"
              type="submit"
              disabled={busy || !nickname.trim()}
            >
              {busy
                ? "正在建立…"
                : setupStep === 0
                  ? "選擇曲庫"
                  : "開房間・邀請朋友"}
            </button>
          </div>
        </form>
      ) : !room ? (
        <div className="duel-center">
          <p>找不到這個房間。</p>
          <Link className="primary" to="/duel">
            開新房間
          </Link>
        </div>
      ) : status === "closed" ? (
        <div className="duel-center">
          <UsersIcon />
          <h2 role="alert">
            {room.closedBy
              ? room.closedBy.id === me?.id
                ? "你已離開對戰"
                : "對手已離開"
              : "這場對決已結束"}
          </h2>
          <p>
            {room.closedBy
              ? room.closedBy.id === me?.id
                ? "房間已關閉，對手已收到通知。"
                : `${room.closedBy.nickname || "對手"} 已離開，這場對決已結束。`
              : "房間已到期，請重新建立對決。"}
          </p>
          <Link className="primary" to="/duel">
            再開一場
          </Link>
        </div>
      ) : !me ? (
        <form
          className="duel-setup duel-join"
          onSubmit={(event) => {
            event.preventDefault();
            void enter(false);
          }}
        >
          <UsersIcon className="duel-join-icon" />
          <h2>{room.players?.[0]?.nickname || "朋友"} 的房間</h2>
          <SettingsLabel settings={room.settings} mode={room.mode} />
          <label className="duel-nickname">
            你的暱稱
            <input
              value={nickname}
              onChange={(event) =>
                setNickname(savePlayerName(event.target.value))
              }
              maxLength={20}
              required
              autoComplete="nickname"
              placeholder="讓朋友認出你"
            />
          </label>
          <button
            className="primary"
            disabled={busy || !nickname.trim() || status !== "waiting"}
          >
            {busy ? "加入中…" : status === "waiting" ? "加入對戰" : "房間已滿"}
          </button>
        </form>
      ) : status === "waiting" ? (
        <div className="duel-lobby">
          <div className="duel-lobby-symbol" aria-hidden="true">
            <UsersIcon />
          </div>
          <h2>把這場挑戰傳給朋友</h2>
          <SettingsLabel settings={room.settings} mode={room.mode} />
          <div className="duel-invite">
            <LinkIcon aria-hidden="true" />
            <input
              ref={current}
              aria-label="邀請連結"
              value={invite}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button onClick={copyInvite} aria-label="複製邀請連結">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          <p className="duel-hint" role="status">
            {copied
              ? "已複製，傳給朋友就能加入。"
              : "朋友加入後，第一首就會準備好。"}
          </p>
          <PlayerStrip room={room} />
        </div>
      ) : (
        <>
          {status !== "finished" &&
            !(status === "playing" && !me.done && room.preview) && (
              <PlayerStrip room={room} />
            )}
          {status === "playing" && !me.done && room.preview ? (
            <div className="duel-round">
              <div className="duel-stage">
                <PlayerStrip room={room} />
                <PreviewPlayer
                  key={`${code}-${room.round}`}
                  song={room.preview}
                  revealed={false}
                  limit={me.clipSeconds || 1}
                  fullDuration={me.duration}
                  stagePoints={me.points ?? 1000}
                  onDuration={(value) => {
                    duration.current = value;
                  }}
                  onPlaybackStarted={(result) => {
                    if (!stateRef.current?.me?.heard)
                      return action("play", {
                        duration: result?.duration || duration.current,
                      });
                  }}
                  onExtend={() => action("extend")}
                  canExtend={
                    me.canExtend ??
                    ((me.stage || 0) < 5 &&
                      (me.clipSeconds || 1) < duration.current)
                  }
                  extendDisabled={busy || !connected}
                  disabled={busy || !connected}
                />
              </div>
              <div className="duel-answer">
                <p className="duel-feedback" role="status">
                  {me.feedback || "輸入歌名，也能搜尋歌手。"}
                </p>
                <GuessInput
                  key={`${room.round}-${me.stage}`}
                  songs={pool}
                  onGuess={(guess) =>
                    action("guess", {
                      answer: guess.text,
                      songId: guess.song?.id,
                    })
                  }
                  disabled={busy || !connected || !me.heard}
                />
                <button
                  className="duel-reveal"
                  disabled={busy || !connected}
                  onClick={() => action("reveal")}
                >
                  放棄這題・等待揭曉
                </button>
              </div>
            </div>
          ) : status === "playing" ? (
            <div className="duel-center duel-wait">
              <CheckIcon />
              <h2>已完成作答</h2>
              <p>等對手猜完，再一起揭曉。</p>
              <span className="duel-pulse" aria-hidden="true">
                ● ● ●
              </span>
            </div>
          ) : opponentEnded ? (
            <div className="duel-center duel-ended-pending">
              <CheckIcon />
              <h2>對戰已結束</h2>
              <p>確認通知後，查看本場分數。</p>
            </div>
          ) : (
            <div className="duel-result">
              {status !== "finished" && room.answer && (
                <div className="duel-song">
                  {room.answer.artwork && (
                    <img src={room.answer.artwork} alt="" />
                  )}
                  <div>
                    <span>這首歌是</span>
                    <h2>{room.answer.title}</h2>
                    <p>{room.answer.artist}</p>
                    <a
                      href={appleURL(room.answer)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Apple Music ↗
                    </a>
                  </div>
                </div>
              )}
              <div
                className={`duel-scoreboard ${status === "finished" ? "duel-final-scoreboard" : ""} ${room.players?.length === 1 ? "is-single" : ""}`}
              >
                {status === "finished"
                  ? room.players?.map((player) => (
                      <div
                        key={player.id}
                        className={player.id === me.id ? "is-you" : ""}
                      >
                        <h3>
                          {player.nickname}
                          {player.id === me.id ? "（你）" : ""}
                        </h3>
                        <span className="duel-final-caption">累積分數</span>
                        <strong className="duel-final-total">
                          {(player.score || 0).toLocaleString()}
                        </strong>
                        {Number.isFinite(player.played) && (
                          <p>
                            {player.correct || 0} / {player.played} 首猜中
                          </p>
                        )}
                      </div>
                    ))
                  : room.results?.map((result) => (
                      <div
                        key={`${room.round}-${result.id}`}
                        className={result.id === me.id ? "is-you" : ""}
                      >
                        <h3>
                          {result.nickname}
                          {result.id === me.id ? "（你）" : ""}
                        </h3>
                        <ScoreRoll
                          points={result.points}
                          total={result.total}
                          previousTotal={result.previousTotal}
                        />
                        <p>{result.correct ? "答對了" : "這題未得分"}</p>
                      </div>
                    ))}
              </div>
              {status === "finished" ? (
                <>
                  <p className="duel-winner">
                    {room.players?.length < 2
                      ? "挑戰尚未開始，已結算。"
                      : room.players?.every(
                            (player) => player.score === room.players[0].score,
                          )
                        ? "不分上下，平手！"
                        : `${[...(room.players || [])].sort((a, b) => b.score - a.score)[0]?.nickname} 贏得對決！`}
                  </p>
                  <div className="result-finished-actions">
                    <Link className="primary" to="/duel">
                      再開一場
                    </Link>
                    <ShareResultButton sessionId={room.code} />
                  </div>
                </>
              ) : (
                <div className="duel-next">
                  <div className="duel-round-actions">
                    <button
                      className="duel-end-round"
                      disabled={busy || !connected}
                      onClick={askToEnd}
                    >
                      結束
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !connected || me.ready}
                      onClick={() => action("ready")}
                    >
                      {me.ready ? "已準備" : "準備"}
                    </button>
                  </div>
                  <p className="duel-hint">
                    {room.players?.filter((player) => player.ready).length || 0}{" "}
                    / 2 人已準備
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <dialog
        ref={leaveDialog}
        className="duel-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duel-leave-title"
        aria-describedby="duel-leave-description"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setLeaving(false);
        }}
        onClose={() => setLeaving(false)}
      >
        <span className="duel-modal-eyebrow">END THE CHALLENGE</span>
        <h2 id="duel-leave-title">結束這場對決？</h2>
        <p id="duel-leave-description">
          保留已完成作答得分，立即結算並通知對手查看分數。尚未完成的作答不會計分。
        </p>
        {leaveError && (
          <p className="duel-error" role="alert">
            {leaveError}
          </p>
        )}
        <div>
          <button
            ref={leaveCancel}
            disabled={busy}
            onClick={() => setLeaving(false)}
          >
            繼續挑戰
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setLeaveError("");
              if (await action("finish")) setLeaving(false);
            }}
          >
            {busy ? "正在結算…" : "確認結束"}
          </button>
        </div>
      </dialog>
      <dialog
        ref={endedDialog}
        className="duel-confirm duel-ended-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duel-ended-title"
        aria-describedby="duel-ended-description"
        onCancel={(event) => event.preventDefault()}
      >
        <span className="duel-modal-eyebrow">CHALLENGE COMPLETE</span>
        <h2 id="duel-ended-title">對戰已結束</h2>
        <p id="duel-ended-description">
          {room?.endedBy?.nickname || "對手"} 已結束對戰，請查看分數。
        </p>
        <div>
          <button
            ref={endedConfirm}
            className="primary"
            onClick={acknowledgeEnd}
          >
            確認
          </button>
        </div>
      </dialog>
    </section>
  );
}
