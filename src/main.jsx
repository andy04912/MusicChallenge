import React, { Component, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router";
import "@fontsource/barlow-condensed/latin-800.css";
import "./styles.css";
import "./shell.css";
import AppShell from "./components/AppShell.jsx";
import GamePage from "./pages/GamePage.jsx";
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
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
            <Route
              path="admin"
              element={
                <Suspense
                  fallback={
                    <div className="page-loading" role="status">
                      正在載入管理後台…
                    </div>
                  }
                >
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
