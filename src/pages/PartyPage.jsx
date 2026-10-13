import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
import {
  CheckIcon,
  CopyIcon,
  PlayIcon,
  StopIcon,
  UsersThreeIcon,
  QuestionIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import QRCode from "qrcode";
import { request, appleURL } from "../lib/api.js";
import { readPlayerName, savePlayerName } from "../lib/player-name.js";
import { decadeLabels, filterPool } from "../lib/game-logic.js";
import { validRoomCode } from "../lib/room-client.js";
import {
  partyPath,
  partyAction,
  subscribeParty,
  partyInviteOrigin,
} from "../lib/party-client.js";
import { ClipAudio } from "../lib/clip-audio.js";
import GuessInput from "../components/GuessInput.jsx";
import Turntable from "../components/Turntable.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PartyPodium from "../components/PartyPodium.jsx";
import ShareResultButton from "../components/ShareResultButton.jsx";
import "./party.css";

export function PartyAudio({ preview, status, disabled, onStarted }) {
  const engine = useRef(null),
    progress = useRef(null),
    generation = useRef(0),
    callbacks = useRef(onStarted);
  callbacks.current = onStarted;
  const [ready, setReady] = useState(false),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(false),
    [duration, setDuration] = useState(0),
    [error, setError] = useState("");
  async function prepare(player = engine.current) {
    if (!player) return;
    setReady(false);
    setError("");
    try {
      const data = await player.preload();
      if (engine.current === player && data) {
        setDuration(data.duration);
        setReady(true);
      }
    } catch {
      if (engine.current === player) setError("音源準備失敗，請重新載入。");
    }
  }
  useEffect(() => {
    const player = new ClipAudio(preview.preview, setPlaying);
    engine.current = player;
    setDuration(0);
    void prepare(player);
    const hide = () => {
      if (document.hidden) {
        generation.current++;
        player.pause();
        setBusy(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      generation.current++;
      player.onState = () => {};
      player.dispose();
      engine.current = null;
      document.removeEventListener("visibilitychange", hide);
    };
  }, [preview.preview, preview.id]);
  useEffect(() => {
    if (status === "revealed" || status === "finished") {
      generation.current++;
      engine.current?.pause();
      setBusy(false);
    }
  }, [status]);
  useEffect(() => {
    if (!playing) {
      if (progress.current)
        progress.current.value = engine.current?.position || 0;
      return;
    }
    let frame;
    const tick = () => {
      if (progress.current)
        progress.current.value = engine.current?.position || 0;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  async function play() {
    if (playing) {
      generation.current++;
      engine.current?.pause();
      setBusy(false);
      return;
    }
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      // Start from the gesture to unlock iOS audio; open guessing only after sound started.
      const data = await engine.current.play(Infinity);
      if (!data || id !== generation.current) return;
      setDuration(data.duration);
      if ((await callbacks.current?.(data)) === false) {
        engine.current?.pause();
        setError("尚未開放作答，請重新播放並開始。");
      }
    } catch {
      if (id === generation.current) {
        engine.current?.pause();
        setError("播放失敗，請再試一次。");
      }
    } finally {
      if (id === generation.current) setBusy(false);
    }
  }
  return (
    <div className="party-audio">
      <Turntable playing={playing} loading={!ready && !error} />
      <div className="party-play-row">
        <button
          className="party-play"
          aria-label={
            playing
              ? "停止播放"
              : status === "playing"
                ? "重新播放完整試聽"
                : "播放並開始作答"
          }
          onClick={play}
          disabled={!ready || disabled || busy || status === "revealed"}
        >
          {playing ? <StopIcon weight="fill" /> : <PlayIcon weight="fill" />}
          <span>
            {!ready
              ? "準備中"
              : busy
                ? "開放作答中"
                : playing
                  ? "停止播放"
                  : status === "playing"
                    ? "重新播放"
                    : "播放並開始"}
          </span>
        </button>
        <div>
          <strong>完整試聽</strong>
          <p>
            {duration ? `${Number(duration.toFixed(1))} 秒` : "正在準備音源"} ·
            不循環
          </p>
          <progress
            ref={progress}
            max={duration || 90}
            value="0"
            aria-label="主控播放進度"
          />
        </div>
      </div>
      <p className="party-audio-credit">
        Song preview provided courtesy of iTunes
      </p>
      {error && (
        <p className="party-error" role="alert">
          {error}
          <button onClick={() => prepare()}>重新載入</button>
        </p>
      )}
    </div>
  );
}
function Participants({ players = [], live = false }) {
  const [page, setPage] = useState(0),
    [small, setSmall] = useState(
      () => window.matchMedia("(max-width: 680px)").matches,
    );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const update = () => {
      setSmall(media.matches);
      setPage(0);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const size = small ? 3 : 4;
  const ordered = live
    ? [...players].sort(
        (a, b) =>
          (a.status === "correct" ? a.place : Infinity) -
          (b.status === "correct" ? b.place : Infinity),
      )
    : players;
  const pages = Math.max(1, Math.ceil(ordered.length / size)),
    current = Math.min(page, pages - 1);
  return (
    <div className="party-participants">
      <div className="party-list-heading">
        <h2>{live ? "即時搶答順序" : "參加者"}</h2>
        <span>{players.length} 人</span>
      </div>
      {players.length ? (
        <ol>
          {ordered
            .slice(current * size, current * size + size)
            .map((player, index) => (
              <li key={player.id}>
                <span
                  className={`party-place ${player.status === "correct" ? "is-correct" : ""}`}
                >
                  {player.status === "correct"
                    ? player.place
                    : current * size + index + 1}
                </span>
                <div>
                  <strong>{player.nickname}</strong>
                  <small>
                    {live
                      ? {
                          correct: "猜中了",
                          gaveup: "已放棄",
                          guessing: "作答中",
                          waiting: "準備中",
                        }[player.status] || "準備中"
                      : "已加入，等待主控播放"}
                  </small>
                </div>
                <b>
                  {live && player.status === "correct"
                    ? `+${player.points}`
                    : player.score?.toLocaleString() || 0}
                </b>
              </li>
            ))}
        </ol>
      ) : (
        <p className="party-empty">掃描 QR Code，第一位挑戰者就是你。</p>
      )}
      {pages > 1 && (
        <div className="party-pages">
          <button
            aria-label="上一頁參加者"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            <ArrowLeftIcon />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            aria-label="下一頁參加者"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ArrowRightIcon />
          </button>
        </div>
      )}
    </div>
  );
}

export default function PartyPage() {
  const [hostTab, setHostTab] = useState("invite");
  const { code } = useParams(),
    navigate = useNavigate(),
    { setGameActive, showHelp } = useOutletContext() || {};
  const [room, setRoom] = useState(null),
    [catalog, setCatalog] = useState([]),
    [nickname, setNickname] = useState(() => readPlayerName()),
    [settings, setSettings] = useState({
      region: "kr",
      category: "all",
      decade: "all",
    });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(true),
    [origins, setOrigins] = useState([]),
    [origin, setOrigin] = useState(window.location.origin),
    [qr, setQr] = useState(""),
    [copied, setCopied] = useState(false),
    [ending, setEnding] = useState(false),
    [attempt, setAttempt] = useState(0);
  const current = useRef(null),
    mounted = useRef(true),
    pending = useRef(false),
    inviteInput = useRef(null),
    endDialog = useRef(null),
    cancelEnd = useRef(null);
  current.current = room;
  function accept(next) {
    if (
      !mounted.current ||
      !next ||
      (current.current?.code === next.code &&
        current.current.revision > next.revision)
    )
      return;
    current.current = next;
    setRoom(next);
  }
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    setLoading(true);
    setRoom(null);
    current.current = null;
    setError("");
    const load = async () => {
      try {
        if (code && !validRoomCode(code))
          throw new Error("邀請連結不完整，請重新掃描 QR Code。");
        const player = await request("/api/player", { signal: abort.signal });
        if (abort.signal.aborted) return;
        setNickname(readPlayerName(player.nickname));
        if (code)
          accept(await request(partyPath(code), { signal: abort.signal }));
        const songs = await request("/api/catalog", { signal: abort.signal });
        if (!abort.signal.aborted) setCatalog(songs);
      } catch (err) {
        if (!abort.signal.aborted) setError(err.message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    request("/api/config", { signal: abort.signal })
      .then((config) => {
        if (abort.signal.aborted) return;
        const choices = Array.isArray(config.partyJoinOrigins)
          ? config.partyJoinOrigins
          : [];
        setOrigins(choices);
        setOrigin(partyInviteOrigin(window.location.origin, choices));
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [code]);
  const member = !!(room?.isHost || room?.me),
    active = member && room?.status === "playing";
  useEffect(() => {
    setGameActive?.(active);
    return () => setGameActive?.(false);
  }, [active, setGameActive]);
  useEffect(() => {
    if (!code || !member || room?.status === "finished") return;
    return subscribeParty(code, accept, setConnected);
  }, [code, member, room?.status === "finished"]);
  useEffect(() => {
    if (room?.status === "finished") setEnding(false);
  }, [room?.status]);
  useEffect(() => {
    const dialog = endDialog.current;
    if (ending && dialog && !dialog.open) {
      dialog.showModal();
      cancelEnd.current?.focus();
    } else if (!ending && dialog?.open) dialog.close();
  }, [ending]);
  const invite = code ? `${origin}/party/${encodeURIComponent(code)}` : "";
  useEffect(() => {
    if (!invite || !room?.isHost) return;
    let ignore = false;
    setQr("");
    QRCode.toDataURL(invite, {
      width: 360,
      margin: 1,
      color: { dark: "#202024", light: "#fffefa" },
    })
      .then((value) => {
        if (!ignore) setQr(value);
      })
      .catch(() => {
        if (!ignore) setError("QR Code 暫時無法產生，可先複製邀請連結。");
      });
    return () => {
      ignore = true;
    };
  }, [invite, room?.isHost]);
  async function action(name, body = {}) {
    if (pending.current || !current.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      accept(await partyAction(current.current, name, body));
      if (name === "guess") setAttempt((value) => value + 1);
      return true;
    } catch (err) {
      if (mounted.current) setError(err.message);
      try {
        accept(await request(partyPath(code)));
      } catch {}
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
    try {
      savePlayerName(nickname.trim());
      await request("/api/player", {
        method: "PATCH",
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
      const next = await request(
        create ? "/api/parties" : partyPath(code, "join"),
        { method: "POST", body: JSON.stringify(create ? settings : {}) },
      );
      if (!mounted.current) return;
      if (create) navigate(`/party/${next.code}`, { replace: true });
      else accept(next);
    } catch (err) {
      if (mounted.current) setError(err.message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch {
      inviteInput.current?.focus();
      inviteInput.current?.select();
      setError("請長按邀請連結，手動複製。");
    }
  }
  const host = room?.isHost,
    status = room?.status,
    me = room?.me,
    players = room?.players || [];
  const pool = room
    ? filterPool(
        catalog,
        room.settings.region,
        room.settings.category,
        room.settings.decade,
      )
    : [];
  const localhost =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(invite);
  const title = !code
    ? "派對搶答"
    : status === "finished"
      ? "派對頒獎典禮"
      : status === "lobby"
        ? "讓朋友一起加入"
        : `第 ${room?.round || 1} 首 · 派對搶答`;
  const audio =
    host && room.preview && status !== "finished" ? (
      <PartyAudio
        key={room.roundId}
        preview={room.preview}
        status={status}
        disabled={busy || !connected || (status === "lobby" && !players.length)}
        onStarted={() =>
          current.current?.status === "playing" ? true : action("start")
        }
      />
    ) : null;
  const invitation = (
    <div className="party-invitation">
      <div className="party-qr">
        {qr ? (
          <img src={qr} width="180" height="180" alt="掃描加入這場派對" />
        ) : (
          <UsersThreeIcon />
        )}
      </div>
      <h2>手機掃一下，一起猜。</h2>
      <p>最多 {room?.capacity || 50} 位玩家 · 主控播放音樂</p>
      {origins.length > 1 && (
        <label className="party-origin">
          手機連線位址
          <select
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          >
            {origins.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="party-invite-link">
        <input
          ref={inviteInput}
          value={invite}
          readOnly
          aria-label="派對邀請連結"
          onFocus={(event) => event.target.select()}
        />
        <button onClick={copy} aria-label="複製派對連結">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <p className="party-network-note">
        {localhost
          ? "localhost 只能在這台電腦開啟；請使用可連線的網址或部署後再讓手機加入。"
          : origins.includes(origin)
            ? "手機與主控需連上相同 Wi-Fi；若無法開啟，請確認電腦防火牆允許連線。"
            : copied
              ? "連結已複製，可以傳給朋友。"
              : "只要一台主控播放，其餘手機負責搶答。"}
      </p>
    </div>
  );
  return (
    <section
      className={`party-page party-${status || "setup"} ${host ? "party-host" : "party-player"}`}
      aria-labelledby="party-title"
    >
      <header className="party-header">
        <div>
          <p>ONE ROOM. MANY EARS.</p>
          <h1 id="party-title">{title}</h1>
        </div>
        {host && status !== "finished" && (
          <button className="party-end" onClick={() => setEnding(true)}>
            結束
          </button>
        )}
        {showHelp && (
          <button
            className="game-help-button"
            aria-label="玩法說明"
            onClick={() => showHelp("party")}
          >
            <QuestionIcon />
          </button>
        )}
      </header>
      {error && !ending && (
        <p className="party-error" role="alert">
          {error}
        </p>
      )}
      {!connected && member && status !== "finished" && (
        <p className="party-network-note" role="status">
          正在重新連線，作答與分數已保留。
        </p>
      )}
      {!host &&
        member &&
        room.hostConnected === false &&
        ["ready", "playing", "revealed"].includes(status) && (
          <p className="party-network-note" role="status">
            主機暫時離線，等待重新連線。作答與得分已保留。
          </p>
        )}
      {loading ? (
        <LoadingState label="正在連接派對…" />
      ) : !code ? (
        <form
          className="party-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void enter(true);
          }}
        >
          <UsersThreeIcon className="party-setup-icon" />
          <p>一台主控放歌，朋友用手機搶答。越早猜中，得分越高。</p>
          <label>
            主控暱稱
            <input
              value={nickname}
              onChange={(event) =>
                setNickname(savePlayerName(event.target.value))
              }
              maxLength={20}
              autoComplete="nickname"
              required
            />
          </label>
          <div className="party-setting-grid">
            <label>
              曲庫
              <select
                value={settings.region}
                onChange={(event) =>
                  setSettings({ ...settings, region: event.target.value })
                }
              >
                <option value="tw">華語</option>
                <option value="kr">K-POP</option>
              </select>
            </label>
            <label>
              聲音
              <select
                value={settings.category}
                onChange={(event) =>
                  setSettings({ ...settings, category: event.target.value })
                }
              >
                <option value="all">不限</option>
                <option value="girl">女聲</option>
                <option value="boy">男聲</option>
                <option value="other">男女合唱</option>
              </select>
            </label>
            <label className="party-decade">
              年代
              <select
                value={settings.decade}
                onChange={(event) =>
                  setSettings({ ...settings, decade: event.target.value })
                }
              >
                {Object.entries(decadeLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="primary" disabled={busy || !nickname.trim()}>
            {busy ? "正在建立…" : "建立派對・顯示 QR Code"}
          </button>
        </form>
      ) : !room ? (
        <div className="party-center">
          <p>找不到這場派對。</p>
          <Link to="/party">建立新派對</Link>
        </div>
      ) : !member ? (
        <form
          className="party-setup"
          onSubmit={(event) => {
            event.preventDefault();
            void enter(false);
          }}
        >
          <UsersThreeIcon className="party-setup-icon" />
          <h2>{room.host?.nickname} 的派對</h2>
          <p>
            {room.playerCount} / {room.capacity} 人 ·{" "}
            {room.settings.region === "tw" ? "華語" : "K-POP"}
          </p>
          <label>
            你的暱稱
            <input
              value={nickname}
              onChange={(event) =>
                setNickname(savePlayerName(event.target.value))
              }
              maxLength={20}
              required
              autoComplete="nickname"
            />
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              !nickname.trim() ||
              status !== "lobby" ||
              room.playerCount >= room.capacity
            }
          >
            {status !== "lobby"
              ? "派對已開始，無法加入"
              : room.playerCount >= room.capacity
                ? "派對已額滿"
                : busy
                  ? "加入中…"
                  : "加入搶答"}
          </button>
        </form>
      ) : status === "finished" ? (
        <div className="party-finished">
          <PartyPodium
            players={players.map((player) => ({
              ...player,
              isYou: player.id === me?.id,
            }))}
            rounds={Math.max(0, ...players.map((player) => player.played || 0))}
          />
          <div className="result-finished-actions">
            <Link className="primary" to="/party">
              再開一場
            </Link>
            <ShareResultButton sessionId={room.code} />
          </div>
        </div>
      ) : host ? (
        <div
          className={`party-host-layout ${status === "lobby" ? "is-lobby" : ""}`}
        >
          <div className="party-host-stage">
            {audio}
            {status === "revealed" && room.answer && (
              <div className="party-answer-song">
                <span>答案揭曉</span>
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
            )}
            <div className="party-host-controls">
              {status === "playing" && (
                <button
                  className="primary"
                  disabled={busy || !connected}
                  onClick={() => action("reveal")}
                >
                  揭曉答案
                </button>
              )}
              {status === "revealed" && (
                <button
                  className="primary"
                  disabled={busy || !connected}
                  onClick={() => action("next")}
                >
                  下一首・準備播放 <ArrowRightIcon />
                </button>
              )}
              {status === "ready" && <p>播放後才會開放手機作答。</p>}
              {status === "lobby" && (
                <p>
                  {players.length
                    ? `${players.length} 位玩家已加入，可以播放第一首。`
                    : "等待至少一位玩家加入。"}
                </p>
              )}
            </div>
          </div>
          <div className="party-host-side">
            {status === "lobby" && (
              <div
                className="party-lobby-tabs"
                role="group"
                aria-label="派對資訊"
              >
                <button
                  aria-pressed={hostTab === "invite"}
                  onClick={() => setHostTab("invite")}
                >
                  邀請加入
                </button>
                <button
                  aria-pressed={hostTab === "players"}
                  onClick={() => setHostTab("players")}
                >
                  參加者 {players.length}
                </button>
              </div>
            )}
            {status === "lobby" && hostTab === "invite" ? (
              invitation
            ) : (
              <Participants players={players} live={status !== "lobby"} />
            )}
          </div>
        </div>
      ) : (
        <div className="party-mobile-game">
          <div className="party-your-score">
            <span>{me?.nickname}</span>
            <strong>
              {(me?.score || 0).toLocaleString()}
              <small> 分</small>
            </strong>
          </div>
          {status === "lobby" || status === "ready" ? (
            <div className="party-center party-await">
              <UsersThreeIcon />
              <h2>
                {status === "lobby"
                  ? "加入成功，派對等你。"
                  : "下一首，準備好了。"}
              </h2>
              <p>聽主控的音樂，播放後即可搶答。</p>
            </div>
          ) : status === "playing" ? (
            <div className="party-player-answer">
              {me?.status === "correct" ? (
                <div className="party-answer-status">
                  <TrophyIcon />
                  <h2>第 {me.place} 位猜中！</h2>
                  <strong>+{me.points} 分</strong>
                  <p>等其他朋友猜完，或由主控揭曉。</p>
                </div>
              ) : me?.status === "gaveup" ? (
                <div className="party-answer-status">
                  <CheckIcon />
                  <h2>已放棄這題</h2>
                  <p>等主控揭曉，一起聽下一首。</p>
                </div>
              ) : (
                <>
                  <h2>聽現場，猜這首。</h2>
                  <p role="status">
                    {me?.feedback || "歌名或歌手都能搜尋，答錯可以繼續猜。"}
                  </p>
                  <GuessInput
                    key={`${room.roundId}-${attempt}`}
                    songs={pool}
                    disabled={busy || !connected}
                    disabledPlaceholder={busy ? "正在送出…" : "等待重新連線…"}
                    onGuess={(guess) =>
                      action("guess", {
                        answer: guess.text,
                        songId: guess.song?.id,
                      })
                    }
                  />
                  <button
                    className="party-giveup"
                    disabled={busy || !connected}
                    onClick={() => action("giveup")}
                  >
                    放棄這題
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="party-answer-song">
              <span>
                {me?.status === "correct"
                  ? `第 ${me.place} 位猜中 · +${me.points} 分`
                  : "答案揭曉"}
              </span>
              <h2>{room.answer?.title}</h2>
              <p>{room.answer?.artist}</p>
              {room.answer && (
                <a
                  href={appleURL(room.answer)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apple Music ↗
                </a>
              )}
              <small>等待主控開下一首。</small>
            </div>
          )}
          <Participants players={players} live={status !== "lobby"} />
        </div>
      )}
      <dialog
        ref={endDialog}
        className="party-end-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="party-end-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setEnding(false);
        }}
        onClose={() => setEnding(false)}
      >
        <span>AWARDS TIME</span>
        <h2 id="party-end-title">結束派對，準備頒獎？</h2>
        <p>保留目前得分，所有人會一起進入頒獎畫面。</p>
        {error && (
          <p className="party-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            ref={cancelEnd}
            disabled={busy}
            onClick={() => setEnding(false)}
          >
            繼續玩
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (await action("finish")) setEnding(false);
            }}
          >
            {busy ? "結算中…" : "結束並頒獎"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
