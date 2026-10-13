import Turntable from "./Turntable.jsx";
import "./LoadingState.css";

export default function LoadingState({ label = "載入中…" }) {
  return (
    <div className="music-loading" role="status" aria-live="polite">
      <div className="music-loading-deck">
        <Turntable loading decorative />
      </div>
      <p>{label}</p>
    </div>
  );
}
