import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  TrophyIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { request } from "../lib/api.js";
import LoadingState from "../components/LoadingState.jsx";
export default function LeaderboardPage() {
  const [mode, setMode] = useState("classic"),
    [region, setRegion] = useState("all");
  const [{ page, limit }, setPagination] = useState({ page: 0, limit: 0 });
  const setPage = (page) =>
    setPagination((previous) => ({ ...previous, page }));
  const [data, setData] = useState({ entries: [], hasMore: false }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const list = useRef(null);
  useLayoutEffect(() => {
    const element = list.current;
    const measure = () => {
      const rowHeight =
        parseFloat(
          getComputedStyle(element).getPropertyValue("--board-row-height"),
        ) || 76;
      const capacity = Math.max(
        1,
        Math.min(20, Math.floor(element.clientHeight / rowHeight)),
      );
      // Changing capacity also resets the offset, in the same state update.
      setPagination((previous) =>
        previous.limit === capacity ? previous : { page: 0, limit: capacity },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (!limit) return;
    const abort = new AbortController();
    setLoading(true);
    setError("");
    request(
      `/api/leaderboard?mode=${mode}&region=${region}&offset=${page * limit}&limit=${limit}`,
      { signal: abort.signal },
    )
      .then((value) => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [mode, region, page, retry, limit]);
  return (
    <section className="leaderboard-page" aria-labelledby="leaderboard-title">
      <div className="board-heading">
        <div>
          <p className="eyebrow">HALL OF FAME</p>
          <h1 id="leaderboard-title">音樂榮譽榜</h1>
        </div>
        <TrophyIcon weight="duotone" />
      </div>
      <div className="board-filters">
        <div className="board-modes" aria-label="排行榜模式">
          {[
            ["classic", "經典五首"],
            ["endless", "無限挑戰"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={mode === id}
              onClick={() => {
                setMode(id);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="board-region">
          排行榜曲庫
        </label>
        <select
          id="board-region"
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">所有曲庫</option>
          <option value="tw">華語</option>
          <option value="kr">K-POP</option>
        </select>
      </div>
      <p className="board-caption">每位玩家保留最佳成績 · 結束挑戰後上榜</p>
      <div
        ref={list}
        className="board-list"
        aria-live="polite"
        aria-busy={loading}
      >
        {loading ? (
          <LoadingState label="載入排行榜…" />
        ) : error ? (
          <div className="board-empty">
            <p role="alert">{error}</p>
            <button className="text-button" onClick={() => setRetry(retry + 1)}>
              重新載入
            </button>
          </div>
        ) : !data.entries.length ? (
          <p className="board-empty">榜上還有空位，等你來挑戰。</p>
        ) : (
          data.entries.map((entry) => (
            <article
              className="board-row"
              key={`${entry.rank}-${entry.nickname}`}
            >
              <span className="board-rank">
                {String(entry.rank).padStart(2, "0")}
              </span>
              <div>
                <strong>{entry.nickname}</strong>
                <span>
                  {mode === "endless"
                    ? `猜中 ${entry.correct} 首`
                    : `${entry.region === "tw" ? "華語" : "K-POP"} · 猜中 ${entry.correct} / ${entry.played} 首`}
                </span>
              </div>
              <b>
                {entry.score.toLocaleString()}
                <small> 分</small>
              </b>
            </article>
          ))
        )}
      </div>
      <div className="board-pagination">
        <button
          aria-label="排行榜上一頁"
          className="text-button"
          disabled={page === 0 || loading}
          onClick={() => setPage(page - 1)}
        >
          <CaretLeftIcon />
        </button>
        <span>第 {page + 1} 頁</span>
        <button
          aria-label="排行榜下一頁"
          className="text-button"
          disabled={!data.hasMore || loading}
          onClick={() => setPage(page + 1)}
        >
          <CaretRightIcon />
        </button>
      </div>
    </section>
  );
}
