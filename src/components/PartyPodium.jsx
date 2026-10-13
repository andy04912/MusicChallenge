import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  TrophyIcon,
  MedalIcon,
} from "@phosphor-icons/react";
import "./PartyPodium.css";

export function rankedPlayers(players = []) {
  return [...players]
    .sort(
      (a, b) =>
        (Number(a.rank) || Infinity) - (Number(b.rank) || Infinity) ||
        (Number(b.score) || 0) - (Number(a.score) || 0),
    )
    .map((player, index) => ({
      ...player,
      rank: Number(player.rank) || index + 1,
    }));
}
export default function PartyPodium({
  players = [],
  rounds = 0,
  title = "今晚的音樂冠軍。",
  compact = false,
}) {
  const ranked = useMemo(() => rankedPlayers(players), [players]);
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
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const pageSize = small ? 3 : 6,
    pages = Math.max(1, Math.ceil(ranked.length / pageSize)),
    current = Math.min(page, pages - 1);
  const top = ranked.slice(0, 3),
    display =
      top.length === 3
        ? [top[1], top[0], top[2]]
        : top.length === 2
          ? [top[1], top[0]]
          : top;
  return (
    <section
      className={`party-podium ${compact ? "party-podium--compact" : ""}`}
      aria-label="派對最終排名"
    >
      {ranked.length > 0 && (
        <div className="party-fireworks" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      )}
      <header className="party-podium-heading">
        <p>THE FINAL ENCORE</p>
        <h2>{title}</h2>
        <span>
          {ranked.length} 位參賽者 · {rounds} 首歌
        </span>
      </header>
      {ranked.length ? (
        <>
          <div className="party-awards" aria-label="前三名">
            {display.map((player) => {
              const placement = top.indexOf(player) + 1;
              return (
                <article
                  className={`party-award party-award--${placement}`}
                  key={player.id || `${player.rank}-${player.nickname}`}
                  aria-label={`第 ${player.rank} 名 ${player.nickname}，${Number(player.score || 0).toLocaleString()} 分`}
                >
                  <div className="party-award-person">
                    <span className="party-award-medal" aria-hidden="true">
                      {placement === 1 ? (
                        <TrophyIcon weight="fill" />
                      ) : (
                        <MedalIcon weight="fill" />
                      )}
                    </span>
                    <strong title={player.nickname}>
                      {player.nickname}
                      {player.isYou && <small>你</small>}
                    </strong>
                    <b>
                      {Number(player.score || 0).toLocaleString()}
                      <small> 分</small>
                    </b>
                  </div>
                  <div className="party-award-block" aria-hidden="true">
                    <span>{player.rank}</span>
                    <small>{placement === 1 ? "ENCORE" : "MUSIC CLUB"}</small>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="party-roster-heading">
            <span>全員戰果</span>
            <span>{ranked.length} 位參賽者</span>
          </div>
          <ol
            className="party-roster"
            start={current * pageSize + 1}
            aria-label="全部參賽者排名"
          >
            {ranked
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((player) => (
                <li key={player.id || `${player.rank}-${player.nickname}`}>
                  <span className="party-roster-rank">{player.rank}</span>
                  <div>
                    <strong title={player.nickname}>
                      {player.nickname}
                      {player.isYou ? "（你）" : ""}
                    </strong>
                    <span>{Number(player.score || 0).toLocaleString()} 分</span>
                  </div>
                </li>
              ))}
          </ol>
          <nav className="party-roster-pagination" aria-label="參賽者分頁">
            <button
              className="text-button"
              type="button"
              aria-label="上一頁參賽者"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ArrowLeftIcon />
            </button>
            <span aria-live="polite">
              {current + 1} / {pages}
            </span>
            <button
              className="text-button"
              type="button"
              aria-label="下一頁參賽者"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <ArrowRightIcon />
            </button>
          </nav>
        </>
      ) : (
        <p className="party-podium-empty">還沒有參賽者戰果。</p>
      )}
    </section>
  );
}
