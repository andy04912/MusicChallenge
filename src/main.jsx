import React, { Component, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router";
import "@fontsource/barlow-condensed/latin-800.css";
import "./styles.css";
import "./shell.css";
import "./app-layout.css";
import "./player-ui.css";
import AppShell from "./components/AppShell.jsx";
import LoadingState from "./components/LoadingState.jsx";
import GamePage from "./pages/GamePage.jsx";
import { initializePWA } from "./lib/pwa.js";
initializePWA({ register: import.meta.env.PROD });
const DuelPage = lazy(() => import("./pages/DuelPage.jsx"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const ResultPage = lazy(() => import("./pages/ResultPage.jsx"));
const PartyPage = lazy(() => import("./pages/PartyPage.jsx"));
class ErrorBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="wrap error-page">
        <h1>畫面暫時無法載入</h1>
        <p>請重新整理頁面，再試一次。</p>
        <button className="primary" onClick={() => window.location.reload()}>
          重新整理
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<GamePage />} />
            {["party", "party/:code"].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <Suspense fallback={<LoadingState label="載入派對…" />}>
                    <PartyPage />
                  </Suspense>
                }
              />
            ))}
            <Route
              path="result/:id"
              element={
                <Suspense fallback={<LoadingState label="載入戰果…" />}>
                  <ResultPage />
                </Suspense>
              }
            />
            <Route
              path="duel"
              element={
                <Suspense fallback={<LoadingState label="載入對戰…" />}>
                  <DuelPage />
                </Suspense>
              }
            />
            <Route
              path="duel/:code"
              element={
                <Suspense fallback={<LoadingState label="載入房間…" />}>
                  <DuelPage />
                </Suspense>
              }
            />
            <Route
              path="leaderboard"
              element={
                <Suspense fallback={<LoadingState label="載入排行榜…" />}>
                  <LeaderboardPage />
                </Suspense>
              }
            />
            <Route
              path="admin"
              element={
                <Suspense fallback={<LoadingState label="正在載入管理後台…" />}>
                  <AdminPage />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <section className="error-page">
                  <h1>找不到這個頁面</h1>
                  <Link to="/">回到選曲</Link>
                </section>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
