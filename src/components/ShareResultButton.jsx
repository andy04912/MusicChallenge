import { useRef, useState } from "react";
import { useInRouterContext, useNavigate } from "react-router";
import { ShareNetworkIcon } from "@phosphor-icons/react";
import { request } from "../lib/api.js";
import "../pages/result.css";

function Button({ sessionId, className = "", onReady }) {
  const pending = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function share() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await request("/api/results", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      if (!receipt?.id) throw new Error("戰果連結尚未建立，請重試。");
      onReady(receipt.id);
    } catch (err) {
      setError(err.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="share-result-control">
      <button
        type="button"
        className={`share-result-button ${className}`}
        onClick={share}
        disabled={busy || !sessionId}
      >
        <ShareNetworkIcon />
        {busy ? "準備戰果…" : "分享戰果"}
      </button>
      {error && (
        <p role="alert" className="share-result-error">
          {error}
        </p>
      )}
    </div>
  );
}
function RoutedButton(props) {
  const navigate = useNavigate();
  return (
    <Button
      {...props}
      onReady={(id) => navigate(`/result/${encodeURIComponent(id)}`)}
    />
  );
}
export default function ShareResultButton(props) {
  return useInRouterContext() ? (
    <RoutedButton {...props} />
  ) : (
    <Button
      {...props}
      onReady={(id) =>
        window.location.assign(`/result/${encodeURIComponent(id)}`)
      }
    />
  );
}
