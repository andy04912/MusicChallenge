import { useLayoutEffect, useRef } from "react";

// Announce the final total once; the rapidly changing visual number is decorative.
export default function ScoreRoll({
  points,
  total,
  previousTotal = total - points,
}) {
  const label = useRef(null),
    number = useRef(null);
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer,
      frame,
      stopped = false;
    const writeNumber = (value, prefix = "") => {
      if (number.current)
        number.current.textContent = `${prefix}${value.toLocaleString()}`;
    };
    const showTotal = () => {
      if (label.current) label.current.textContent = "累積得分";
    };
    const finish = () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      showTotal();
      writeNumber(total);
    };
    const changed = () => {
      if (media.matches) finish();
    };
    media.addEventListener("change", changed);
    if (media.matches) finish();
    else {
      if (label.current) label.current.textContent = "本題得分";
      writeNumber(points, "+");
      timer = setTimeout(() => {
        showTotal();
        writeNumber(previousTotal);
        const started = performance.now();
        const tick = (now) => {
          if (stopped) return;
          const progress = Math.min(1, (now - started) / 620);
          writeNumber(
            Math.round(
              previousTotal +
                (total - previousTotal) * (1 - (1 - progress) ** 3),
            ),
          );
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }, 950);
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      media.removeEventListener("change", changed);
    };
  }, [points, total, previousTotal]);
  return (
    <div
      className="score-roll"
      aria-label={`本題 ${points} 分，累積 ${total} 分`}
    >
      {/* The animation owns these decorative text nodes; React announces only
          the stable accessible score above. */}
      <span ref={label} aria-hidden="true" />
      <strong ref={number} aria-hidden="true" />
      <small aria-hidden="true">本題 +{points.toLocaleString()}</small>
    </div>
  );
}
