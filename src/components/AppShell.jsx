import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import BrandMark from "./BrandMark.jsx";
import HowToPlay from "./HowToPlay.jsx";
import InstallApp from "./InstallApp.jsx";
import { setPWAActivity } from "../lib/pwa.js";
import useMobileViewport from "../lib/useMobileViewport.js";
import {
  ArrowUpRightIcon,
  HeartIcon,
  TrophyIcon,
  UsersThreeIcon,
  MoonIcon,
  SunIcon,
  VinylRecordIcon,
  QuestionIcon,
  SlidersHorizontalIcon,
  ConfettiIcon,
} from "@phosphor-icons/react";

export default function AppShell() {
  const location = useLocation(),
    dialog = useRef(null),
    shell = useRef(null);
  useMobileViewport(shell);
  const admin = location.pathname.startsWith("/admin");
  const [gameActive, setGameActive] = useState(false);
  useEffect(() => {
    setPWAActivity(gameActive);
    return () => setPWAActivity(false);
  }, [gameActive]);
  const [helpStep, setHelpStep] = useState(0);
  const showHelp = useCallback((mode) => {
    setHelpStep(mode === "party" ? 4 : 0);
    dialog.current?.showModal();
  }, []);
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
      ? "歌曲管理｜Music Challenge"
      : "Music Challenge｜華語・K-POP 猜歌";
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
    <div
      className={`app-shell ${admin ? "admin-shell" : "player-shell"} ${gameActive && !admin ? "is-playing" : ""}`}
      ref={shell}
    >
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <header className="site-header wrap">
        <Link to="/" className="brand" aria-label="Music Challenge 首頁">
          <BrandMark />
          <span className="brand-wordmark">
            <strong>Music Challenge</strong>
            <span className="brand-small">
              {admin ? "MUSIC CONTROL ROOM" : "LISTEN. GUESS. WIN."}
            </span>
          </span>
        </Link>
        <nav className="shell-nav" aria-label="主要導覽">
          {admin ? (
            <Link to="/" className="view-front-link">
              查看前台 <ArrowUpRightIcon aria-hidden="true" />
            </Link>
          ) : null}
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
      <aside className="shell-rail" aria-label="功能導覽">
        <Link
          to="/"
          className={location.pathname === "/" ? "active" : ""}
          aria-current={location.pathname === "/" ? "page" : undefined}
        >
          <VinylRecordIcon />
          <span>猜歌</span>
        </Link>
        {!admin && (
          <>
            <Link
              to="/duel"
              className={location.pathname.startsWith("/duel") ? "active" : ""}
              aria-current={
                location.pathname.startsWith("/duel") ? "page" : undefined
              }
            >
              <UsersThreeIcon />
              <span>好友對戰</span>
            </Link>
            <Link
              to="/party"
              className={location.pathname.startsWith("/party") ? "active" : ""}
              aria-current={
                location.pathname.startsWith("/party") ? "page" : undefined
              }
            >
              <ConfettiIcon />
              <span>派對</span>
            </Link>
            <Link
              to="/leaderboard"
              className={location.pathname === "/leaderboard" ? "active" : ""}
              aria-current={
                location.pathname === "/leaderboard" ? "page" : undefined
              }
            >
              <TrophyIcon />
              <span>排行榜</span>
            </Link>
          </>
        )}
        <button onClick={() => dialog.current.showModal()}>
          <QuestionIcon />
          <span>玩法</span>
        </button>
        {admin && (
          <Link to="/admin" className="active" aria-current="page">
            <SlidersHorizontalIcon />
            <span>歌曲管理</span>
          </Link>
        )}
      </aside>
      <main id="main-content" className="wrap shell-content">
        <Outlet key={location.key} context={{ setGameActive, showHelp }} />
      </main>
      <footer className="site-footer wrap">
        <span>APPLE MUSIC PREVIEWS</span>
        <span className="footer-credit">試聽來源：Apple iTunes</span>
        <InstallApp allowed={!admin && !gameActive} />
        <a
          className="donate-link"
          href="https://portaly.cc/bradydamove/support"
          target="_blank"
          rel="noopener noreferrer"
        >
          <HeartIcon aria-hidden="true" weight="fill" />
          Donate Me!
        </a>
      </footer>
      <HowToPlay dialog={dialog} step={helpStep} setStep={setHelpStep} />
    </div>
  );
}
