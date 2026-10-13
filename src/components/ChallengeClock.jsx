export default function ChallengeClock({ stages, stage }) {
  const current = stages[stage];
  return (
    <div className="compact-stage" aria-label="目前片段與分數">
      <span>{Number(current.seconds.toFixed(1))} 秒片段</span>
      <strong>{current.points.toLocaleString()} 分</strong>
    </div>
  );
}
