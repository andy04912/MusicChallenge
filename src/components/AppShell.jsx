import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import {
  ArrowUpRightIcon,
  XIcon,
  MoonIcon,
  SunIcon,
} from "@phosphor-icons/react";

export default function AppShell() {
  const location = useLocation(),
    dialog = useRef(null);
  const admin = location.pathname.startsWith("/admin");
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    document.title = admin
      ? "歌曲管理｜Seoul Signal"
      : "Seoul Signal｜華語・K-POP 猜歌";
    window.scrollTo(0, 0);
  }, [admin, location.pathname]);
  function toggleTheme() {
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <header className="site-header wrap">
        <Link to="/" className="brand">
          seoul
          <span className="brand-icon" aria-hidden="true">
            ✳
          </span>
          signal
          <span className="brand-small">
            {admin ? "MUSIC CONTROL ROOM" : "MANDO / K-POP CLUB"}
          </span>
        </Link>
        <nav className="shell-nav" aria-label="主要導覽">
          {admin ? (
            <Link to="/">
              查看前台 <ArrowUpRightIcon aria-hidden="true" />
            </Link>
          ) : (
            <button
              className="text-button"
              onClick={() => dialog.current.showModal()}
            >
              玩法說明 <ArrowUpRightIcon aria-hidden="true" />
            </button>
          )}
          <button
            className="theme-toggle"
            aria-label="切換明暗模式"
            onClick={toggleTheme}
          >
            <SunIcon className="sun-icon" />
            <MoonIcon className="moon-icon" />
          </button>
        </nav>
      </header>
      <main id="main-content" className="wrap shell-content">
        <Outlet />
      </main>
      <footer className="site-footer wrap">
        <span>
          SEOUL SIGNAL <span className="footer-star">✳</span> MADE FOR YOUR NEXT
          FAVORITE.
        </span>
        <span>音樂試聽來源：Apple iTunes · 非 Apple 官方網站</span>
      </footer>
      <dialog
        ref={dialog}
        id="how-dialog"
        aria-labelledby="how-title"
        onClick={(event) => {
          if (event.target === dialog.current) {
            const r = dialog.current.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              dialog.current.close();
          }
        }}
      >
        <button
          className="text-button dialog-close"
          aria-label="關閉說明"
          onClick={() => dialog.current.close()}
        >
          <XIcon />
        </button>
        <h2 id="how-title">
          熟悉的歌，
          <br />
          換個方式遇見。
        </h2>
        <ol>
          <li>
            選擇華語或
            K-POP，兩種曲庫不混搭；再選女聲／女團、男聲／男團或男女合併，每輪隨機抽五首。
          </li>
          <li>點擊播放，聆聽 Apple 提供的試聽片段，可隨時暫停或重播。</li>
          <li>
            輸入完整歌名，或輸入歌名／歌手搜尋並選擇歌曲，再送出答案。每題答對的
            分數依首次播放至送出的時間計算：1 秒內 1,000 分、3 秒內 800 分、5
            秒內 600 分、10 秒內 400 分、20 秒內 200 分，超過 20 秒 100
            分。暫停、重播仍持續計時；答錯或直接揭曉 0 分。
          </li>
          <li>認識歌手與專輯，前往 Apple Music 聽更多。</li>
        </ol>
        <p className="small muted">
          試聽為 Apple
          選定的片段，可能不是歌曲開頭。曲目供應會因地區或時間變動。題庫以台灣商店為準。
        </p>
      </dialog>
    </div>
  );
}
