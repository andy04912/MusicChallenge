import { useEffect, useState } from "react";
import { pointsForTime, scoreTiers } from "../lib/game-logic.js";

export default function ChallengeClock({ startedAt }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, performance.now() - startedAt));
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [startedAt]);
  return (
    <div className="challenge-clock">
      <div className="clock-reading">
        <span>
          作答時間
          <strong>
            {(elapsed / 1000).toFixed(1)}
            <small> 秒</small>
          </strong>
        </span>
        <span>
          現在答對
          <strong>
            {pointsForTime(elapsed).toLocaleString()}
            <small> 分</small>
          </strong>
        </span>
      </div>
      <details className="score-rules">
        <summary>計分規則</summary>
        <dl>
          {scoreTiers.map((tier) => (
            <div key={tier.points}>
              <dt>{tier.label}</dt>
              <dd>{tier.points.toLocaleString()} 分</dd>
            </div>
          ))}
        </dl>
        <p>播放後計時，暫停不停止。每題一次機會，答錯或揭曉 0 分。</p>
      </details>
    </div>
  );
}
