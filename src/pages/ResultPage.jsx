import LoadingState from "../components/LoadingState.jsx";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  ShareNetworkIcon,
  XIcon,
} from "@phosphor-icons/react";
import { request } from "../lib/api.js";
import { createResultCard, resultFacts } from "../lib/result-card.js";
import PartyPodium from "../components/PartyPodium.jsx";
import "./result.css";
const mobileQuery = "(pointer: coarse), (max-width: 767px)";

export default function ResultPage() {
  const { id } = useParams(),
    [result, setResult] = useState(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [preparing, setPreparing] = useState(false),
    [card, setCard] = useState(null);
  const [notice, setNotice] = useState(""),
    [copied, setCopied] = useState(false),
    [sharing, setSharing] = useState(false),
    [mobile, setMobile] = useState(
      () => window.matchMedia(mobileQuery).matches,
    ),
    [retry, setRetry] = useState(0);
  const linkInput = useRef(null),
    imageDialog = useRef(null),
    shareBusy = useRef(false);
  const url = `${window.location.origin}/`;
  useEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setResult(null);
    request(`/api/results/${encodeURIComponent(id)}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setResult(value);
      })
      .catch((err) => {
        if (!abort.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [id]);
  useEffect(() => {
    if (!result) return;
    let cancelled = false,
      objectUrl;
    setPreparing(true);
    setCard(null);
    setError("");
    createResultCard(result)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const file = new File([blob], `music-challenge-${result.id}.png`, {
          type: "image/png",
        });
        setCard({ url: objectUrl, file });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPreparing(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [result, retry]);
  function download() {
    if (!card) return;
    if (mobile) {
      share(true);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = card.url;
    anchor.download = card.file.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setNotice("已送出下載請求，請查看瀏覽器的下載項目。");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setNotice("遊戲首頁連結已複製，邀請朋友來挑戰！");
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setNotice("請長按下方連結，手動複製。");
    }
  }
  function share(imageOnly = false) {
    if (!card || shareBusy.current) return;
    const payload = imageOnly
      ? { files: [card.file] }
      : {
          files: [card.file],
          title: "Music Challenge 戰果",
          text:
            result.type === "party"
              ? `${result.players?.length || 0} 人的派對搶答戰果`
              : `${result.nickname} 的音樂挑戰戰果`,
          url,
        };
    // The already prepared File is passed during this click, before any await.
    let canShare = false;
    try {
      canShare =
        !!navigator.share && !!navigator.canShare?.({ files: payload.files });
    } catch {
      /* Use the download and link buttons when capability checks fail. */
    }
    if (!canShare) {
      if (imageOnly) imageDialog.current?.showModal();
      else setNotice("此瀏覽器不支援分享圖片，可儲存圖片或複製連結。");
      return;
    }
    shareBusy.current = true;
    setSharing(true);
    setNotice("");
    try {
      Promise.resolve(navigator.share(payload))
        .then(
          () => setNotice(imageOnly ? "已交給系統處理圖片。" : "已完成分享。"),
          (err) => {
            if (err.name !== "AbortError") {
              if (imageOnly) imageDialog.current?.showModal();
              else setNotice("未能開啟分享，請儲存圖片或複製連結。");
            }
          },
        )
        .finally(() => {
          shareBusy.current = false;
          setSharing(false);
        });
    } catch (err) {
      shareBusy.current = false;
      setSharing(false);
      if (err.name !== "AbortError") {
        if (imageOnly) imageDialog.current?.showModal();
        else setNotice("未能開啟分享，請儲存圖片或複製連結。");
      }
    }
  }
  const facts = result ? resultFacts(result) : null;
  return (
    <section
      className={`result-page ${result?.type === "party" ? "result-page--party" : ""}`}
      aria-labelledby="result-title"
    >
      <header className="result-heading">
        <p>YOUR MUSIC RECEIPT</p>
        <h1 id="result-title">
          {result?.type === "party"
            ? "派對冠軍，正式揭曉。"
            : "把這一輪，分享出去。"}
        </h1>
      </header>
      {loading ? (
        <LoadingState label="正在讀取戰果…" />
      ) : !result ? (
        <div className="result-unavailable">
          <p role="alert">{error || "找不到這份戰果。"}</p>
          <Link className="primary" to="/">
            我也要挑戰
          </Link>
        </div>
      ) : (
        <div className="result-layout">
          {result.type === "party" ? (
            <div className="result-party-stage">
              <PartyPodium
                players={result.players || []}
                rounds={facts.rounds}
                compact
              />
            </div>
          ) : (
            <div className="result-image-wrap">
              {card ? (
                <img
                  className="result-card-image"
                  src={card.url}
                  width="1080"
                  height="1350"
                  alt={`${result.nickname}，${facts.mode}，${facts.region}，${facts.score} 分，${facts.correct} / ${facts.played} 首猜中，答對率 ${facts.accuracy}%。${facts.outcome}。${result.type === "duel" ? (result.players || []).map((player) => `${player.nickname}：${player.score} 分，${player.correct} / ${player.played} 首猜中。`).join("") : ""}`}
                />
              ) : (
                <div className="result-card-placeholder" role="status">
                  {preparing ? "正在製作戰果卡…" : "圖片尚未完成"}
                </div>
              )}
            </div>
          )}
          <div className="result-tools">
            <div className="result-caption">
              <h2>
                {result.type === "party"
                  ? "派對最終戰果"
                  : `${result.nickname} 的戰果`}
              </h2>
              <p>
                {result.type === "party"
                  ? `${facts.participants} 位參賽者 · ${facts.rounds} 首歌 · ${facts.region}`
                  : `${facts.mode} · ${facts.region} · ${facts.score} 分`}
              </p>
            </div>
            {error && (
              <div className="result-render-error">
                <p role="alert">{error}</p>
                <button
                  onClick={() => setRetry((value) => value + 1)}
                  disabled={preparing}
                >
                  重新製作圖片
                </button>
              </div>
            )}
            <div className="result-actions">
              <button
                className="primary"
                onClick={() => share()}
                disabled={!card || sharing}
              >
                <ShareNetworkIcon />
                {sharing ? "正在分享…" : "分享戰果"}
              </button>
              <button onClick={download} disabled={!card || sharing}>
                <DownloadSimpleIcon />
                {mobile ? "儲存圖片" : "下載圖片"}
              </button>
              <button onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}複製連結
              </button>
              <Link to="/">
                我也要挑戰 <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <input
              ref={linkInput}
              className="result-link"
              aria-label="遊戲首頁連結"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
            />
            <p className="result-notice" role="status">
              {notice ||
                (preparing
                  ? "圖片完成後即可分享。"
                  : "分享圖片秀戰果，連結邀朋友直接開始玩。")}
            </p>
          </div>
        </div>
      )}
      {card && (
        <dialog
          ref={imageDialog}
          className="result-save-dialog"
          aria-labelledby="save-image-title"
        >
          <header>
            <h2 id="save-image-title">儲存戰果圖片</h2>
            <button
              type="button"
              aria-label="關閉圖片"
              onClick={() => imageDialog.current.close()}
            >
              <XIcon />
            </button>
          </header>
          <p>長按圖片，選擇儲存影像或加入照片。</p>
          <img
            src={card.url}
            alt="可長按儲存的 Music Challenge 戰果圖片"
            width="1080"
            height="1350"
          />
        </dialog>
      )}
    </section>
  );
}
