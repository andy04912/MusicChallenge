import BrandMark from "./BrandMark.jsx";

export default function Turntable({
  playing = false,
  loading = false,
  artwork,
  decorative = false,
}) {
  return (
    <div
      className={`turntable ${playing || loading ? "is-playing" : ""} ${loading ? "is-loading" : ""}`}
      role={decorative ? undefined : loading ? "status" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={
        decorative
          ? undefined
          : loading
            ? "正在準備試聽"
            : playing
              ? "粉紅唱片盤，黑膠唱片旋轉中"
              : "粉紅唱片盤，黑膠唱片已暫停"
      }
    >
      <span className="deck-brand">Music Challenge</span>
      <div className="vinyl-record">
        <div className="disc-label">
          {artwork ? (
            <img src={artwork} alt="" />
          ) : (
            <BrandMark className="record-brand-mark" />
          )}
        </div>
      </div>
      <span className="tonearm" />
      <span className="deck-status">
        {loading ? "LOADING" : playing ? "NOW SPINNING" : "READY TO PLAY"}
      </span>
    </div>
  );
}
