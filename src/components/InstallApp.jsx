import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowDownIcon,
  ArrowClockwiseIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  applyUpdate,
  dismissInstall,
  getPWASnapshot,
  installInstructions,
  requestInstall,
  subscribePWA,
} from "../lib/pwa.js";
import "./InstallApp.css";

export default function InstallApp({ allowed = true }) {
  const state = useSyncExternalStore(
    subscribePWA,
    getPWASnapshot,
    getPWASnapshot,
  );
  const dialog = useRef(null);
  const [prompting, setPrompting] = useState(false);
  async function install() {
    if (prompting) return;
    setPrompting(true);
    try {
      if ((await requestInstall()) === "manual") dialog.current?.showModal();
    } finally {
      setPrompting(false);
    }
  }
  if (!allowed) return null;
  const installVisible = !state.installed && !state.dismissed;
  if (!installVisible && !state.update) return null;
  return (
    <div className="pwa-controls">
      {state.update ? (
        <button
          type="button"
          className="pwa-footer-button"
          disabled={state.updating}
          onClick={applyUpdate}
        >
          <ArrowClockwiseIcon aria-hidden="true" />
          {state.updating ? "更新中…" : "更新 App"}
        </button>
      ) : (
        installVisible && (
          <button
            type="button"
            className="pwa-footer-button"
            disabled={prompting}
            onClick={install}
          >
            <ArrowDownIcon aria-hidden="true" />
            安裝 App
          </button>
        )
      )}
      {state.message && (
        <span className="pwa-status" role="status">
          {state.message}
        </span>
      )}
      <dialog
        className="install-dialog"
        ref={dialog}
        aria-labelledby="install-title"
      >
        <button
          type="button"
          className="install-close"
          aria-label="關閉安裝說明"
          onClick={() => dialog.current.close()}
        >
          <XIcon />
        </button>
        <img src="/icons/icon-192.png" width="56" height="56" alt="" />
        <h2 id="install-title">把挑戰放進主畫面。</h2>
        <p>{installInstructions()}</p>
        <p className="install-note">安裝後仍需連線才能猜歌與對戰。</p>
        <div>
          <button
            type="button"
            className="primary"
            onClick={() => dialog.current.close()}
          >
            知道了
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              dialog.current.close();
              dismissInstall();
            }}
          >
            暫時不用
          </button>
        </div>
      </dialog>
    </div>
  );
}
