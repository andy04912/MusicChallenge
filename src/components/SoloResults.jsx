import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react";
import { appleURL } from "../lib/api.js";
import ShareResultButton from "./ShareResultButton.jsx";
import "./solo-results.css";

export default function SoloResults({ run, onRestart, error }) {
  const list = useRef(null);
  const [{ page, limit }, setPagination] = useState({ page: 0, limit: 4 });
  useLayoutEffect(() => {
    const element = list.current;
    const measure = () => {
      if (!element.clientHeight) return;
      const rowHeight =
        parseFloat(
          getComputedStyle(element).getPropertyValue("--history-row-height"),
        ) || 64;
      const capacity = Math.max(
        1,
        Math.floor(element.clientHeight / rowHeight),
      );
      setPagination((previous) =>
        previous.limit === capacity
          ? previous
          : {
              page: Math.floor((previous.page * previous.limit) / capacity),
              limit: capacity,
            },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const pages = Math.max(1, Math.ceil(run.history.length / limit));
  const currentPage = Math.min(page, pages - 1);
  const first = currentPage * limit;
  return (
    <section
      className="solo-screen solo-results"
      aria-labelledby="solo-results-title"
    >
      <header className="solo-results-heading">
        <div>
          <p className="solo-kicker">CHALLENGE COMPLETE</p>
          <h1 id="solo-results-title">這一輪，聽得漂亮。</h1>
          <p className="solo-results-summary">
            猜中 {run.correct} / {run.played} 首 ·{" "}
            {run.mode === "classic" ? "經典" : "無限"}挑戰
          </p>
        </div>
        <div className="solo-final-score">
          <strong>{run.score.toLocaleString()}</strong>
          <span>總分</span>
        </div>
      </header>
      <div className="solo-history" ref={list} aria-label="本輪歌曲">
        {run.history.slice(first, first + limit).map((item) => (
          <article className="solo-history-row" key={item.round}>
            <img src={item.song.artwork} alt="" width="44" height="44" />
            <div>
              <strong title={item.song.title}>{item.song.title}</strong>
              <span title={item.song.artist}>{item.song.artist}</span>
            </div>
            <b>+{item.points}</b>
            <a
              href={appleURL(item.song)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`在 Apple Music 聆聽 ${item.song.title}`}
            >
              <ArrowUpRightIcon />
            </a>
          </article>
        ))}
        {!run.history.length && (
          <p className="solo-history-empty">這次還沒有完成的歌曲。</p>
        )}
      </div>
      <footer className="solo-results-footer">
        <div className="solo-pagination" aria-label="歌曲分頁">
          <button
            className="text-button"
            disabled={currentPage === 0}
            onClick={() =>
              setPagination((previous) => ({
                ...previous,
                page: currentPage - 1,
              }))
            }
            aria-label="上一頁歌曲"
          >
            <ArrowLeftIcon />
          </button>
          <span aria-live="polite">
            {run.history.length
              ? `${first + 1}–${Math.min(first + limit, run.history.length)} / ${run.history.length} 首`
              : "0 首"}
          </span>
          <button
            className="text-button"
            disabled={currentPage === pages - 1}
            onClick={() =>
              setPagination((previous) => ({
                ...previous,
                page: currentPage + 1,
              }))
            }
            aria-label="下一頁歌曲"
          >
            <ArrowRightIcon />
          </button>
        </div>
        <div className="result-finished-actions">
          <button className="primary solo-primary" onClick={onRestart}>
            再挑戰一次
            <ArrowRightIcon />
          </button>
          <ShareResultButton sessionId={run.id} />
        </div>
        <p className="solo-message" role="alert">
          {error}
        </p>
      </footer>
    </section>
  );
}
