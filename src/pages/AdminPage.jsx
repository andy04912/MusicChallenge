import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  PlayIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  appleURL,
  request,
  regionLabels,
  categoryLabels,
  statusLabels,
} from "../lib/api.js";
import SelectionCheckbox from "../components/SelectionCheckbox.jsx";
import "../admin.css";

function Select({ label, value, onChange, options, className }) {
  return (
    <label className={className}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function SongRow({ song, discovery, checked, onSelect, onPreview }) {
  const unavailable = discovery && (song.imported || song.unavailable);
  return (
    <div
      className={`management-row ${discovery && song.rank ? "chart-row" : ""}`}
    >
      {discovery && song.rank && (
        <span className="chart-rank" aria-label={`第 ${song.rank} 名`}>
          {String(song.rank).padStart(2, "0")}
        </span>
      )}
      <input
        type="checkbox"
        aria-label={`選擇 ${song.title} · ${song.artist}`}
        checked={checked}
        disabled={unavailable}
        onChange={(event) => onSelect(song.id, event.target.checked)}
      />
      <img
        src={song.artwork || undefined}
        alt=""
        loading="lazy"
        width="54"
        height="54"
      />
      <div className="song-details">
        <strong>{song.title}</strong>
        <p>
          {[song.artist, song.album, song.year].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="row-tags">
        <span className={`status ${song.status || ""}`}>
          {discovery
            ? song.imported
              ? "已在題庫"
              : song.unavailable
                ? "暫無試聽"
                : "可匯入"
            : statusLabels[song.status]}
        </span>
        {!discovery && (
          <>
            <span className="category-tag">
              {categoryLabels[song.category]}
            </span>
            <span className="category-tag">{regionLabels[song.region]}</span>
          </>
        )}
      </div>
      <button
        className="row-preview"
        disabled={!!song.unavailable}
        aria-label={`試聽 ${song.title}`}
        onClick={() => onPreview(song)}
      >
        <PlayIcon /> 試聽
      </button>
    </div>
  );
}
function AdminPreview({ song, onClose, onError }) {
  const audio = useRef(null);
  useEffect(() => {
    const player = audio.current;
    let current = true;
    player.src = song.preview;
    player.play().catch(() => {
      if (current) onError("無法播放此片段，請稍後重試或前往 Apple Music。");
    });
    const pause = () => {
      if (document.hidden) player.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      current = false;
      player.pause();
      player.removeAttribute("src");
      player.load();
      document.removeEventListener("visibilitychange", pause);
    };
  }, [song]);
  return (
    <aside className="preview-player">
      <div>
        <strong>
          {song.title} · {song.artist}
        </strong>
        <span>Song preview provided courtesy of iTunes</span>
      </div>
      <audio ref={audio} controls preload="none" />
      <a href={appleURL(song)} target="_blank" rel="noopener noreferrer">
        Apple Music <ArrowUpRightIcon />
      </a>
      <button className="text-button" aria-label="關閉試聽" onClick={onClose}>
        <XIcon />
      </button>
    </aside>
  );
}
export default function AdminPage() {
  const [auth, setAuth] = useState("checking"),
    [password, setPassword] = useState(""),
    [songs, setSongs] = useState([]);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState({ text: "", error: false });
  const [tab, setTab] = useState("library"),
    [source, setSource] = useState("search"),
    [results, setResults] = useState([]),
    [discoveryMessage, setDiscoveryMessage] =
      useState("搜尋喜歡的歌手，開始擴充你的題庫。"),
    [chartTime, setChartTime] = useState("");
  const [selected, setSelected] = useState(new Set()),
    [importSelected, setImportSelected] = useState(new Set());
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [category, setCategory] = useState("all"),
    [region, setRegion] = useState("all"),
    [appleQuery, setAppleQuery] = useState("");
  const [batchCategory, setBatchCategory] = useState("girl"),
    [batchRegion, setBatchRegion] = useState("tw"),
    [importCategory, setImportCategory] = useState("girl"),
    [importRegion, setImportRegion] = useState("other"),
    [preview, setPreview] = useState(null);
  const csrf = useRef(""),
    locked = useRef(false),
    controller = useRef(null),
    tabRefs = useRef([]);
  function clearAuth() {
    csrf.current = "";
    setAuth("login");
    setSongs([]);
    setResults([]);
    setSelected(new Set());
    setImportSelected(new Set());
    setPreview(null);
  }
  async function api(path, options = {}) {
    try {
      return await request(`/api/admin/${path}`, {
        ...options,
        signal: controller.current.signal,
        headers: { "X-CSRF-Token": csrf.current },
      });
    } catch (error) {
      if (error.status === 401) clearAuth();
      throw error;
    }
  }
  async function refresh() {
    const rows = await api("songs");
    setSongs(rows);
    setSelected(new Set());
    const ids = new Set(rows.map((s) => s.id));
    setResults((old) => old.map((s) => ({ ...s, imported: ids.has(s.id) })));
    setImportSelected((old) => new Set([...old].filter((id) => !ids.has(id))));
  }
  async function run(work) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setNotice({ text: "", error: false });
    try {
      await work();
    } catch (error) {
      if (error.name !== "AbortError")
        setNotice({ text: error.message, error: true });
    } finally {
      locked.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    request("/api/admin/session", { signal: abort.signal })
      .then(async (session) => {
        if (abort.signal.aborted) return;
        csrf.current = session.csrf;
        const rows = await request("/api/admin/songs", {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setSongs(rows);
          setAuth("ready");
        }
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        clearAuth();
        if (error.status !== 401)
          setNotice({ text: "無法連線至後台，請稍後再試。", error: true });
      });
    return () => abort.abort();
  }, []);
  const visible = useMemo(
    () =>
      songs.filter(
        (song) =>
          (status === "all" || song.status === status) &&
          (category === "all" || song.category === category) &&
          (region === "all" || song.region === region) &&
          `${song.title} ${song.artist} ${song.album}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [songs, query, status, category, region],
  );
  const available = results.filter((s) => !s.imported && !s.unavailable);
  function filter(setter, value) {
    setter(value);
    setSelected(new Set());
  }
  function select(setter, id, checked) {
    setter((old) => {
      const next = new Set(old);
      if (checked && next.size >= 200) {
        setNotice({ text: "每批最多操作 200 首，請分批處理。", error: true });
        return old;
      }
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function patch(update, message) {
    await run(async () => {
      const result = await api("songs", {
        method: "PATCH",
        body: JSON.stringify({ ids: [...selected], ...update }),
      });
      await refresh();
      setNotice({
        text: `已更新 ${result.updated} 首歌曲${message}。`,
        error: false,
      });
    });
  }
  async function loadChart(which) {
    setResults([]);
    setImportSelected(new Set());
    setChartTime("");
    setDiscoveryMessage("正在載入排行榜與試聽資訊…");
    try {
      const chart = await api(`charts?type=${which}`);
      setResults(chart.songs);
      setImportRegion(chart.region);
      const time = new Date(chart.updatedAt || chart.fetchedAt);
      setChartTime(
        `榜單時間：${Number.isNaN(time.getTime()) ? "未提供" : time.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}（台北時間），每 30 分鐘更新快取`,
      );
      setDiscoveryMessage(
        `${chart.songs.length} 首上榜歌曲，${chart.songs.filter((s) => !s.unavailable).length} 首可試聽。勾選後加入草稿，再由你決定開放。`,
      );
    } catch (error) {
      setDiscoveryMessage("排行榜載入失敗，請按「重新載入」再試一次。");
      throw error;
    }
  }
  function changeSource(which) {
    run(async () => {
      setSource(which);
      setPreview(null);
      setResults([]);
      setImportSelected(new Set());
      if (which !== "search") {
        setImportCategory("other");
        await loadChart(which);
      } else setDiscoveryMessage("搜尋喜歡的歌手，開始擴充你的題庫。");
    });
  }
  function tabKey(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    setTab(next ? "discover" : "library");
    tabRefs.current[next]?.focus();
  }
  if (auth === "checking")
    return (
      <div className="page-loading" role="status">
        正在確認管理員登入狀態…
      </div>
    );
  return (
    <div className="admin-main">
      {auth === "login" ? (
        <section className="login-view">
          <p className="eyebrow">FOR YOUR NEXT RELEASE</p>
          <h1>好歌，等你開放。</h1>
          <p className="muted">登入後台，安排你的音樂題庫。</p>
          <form
            id="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const session = await api("login", {
                  method: "POST",
                  body: JSON.stringify({ password }),
                });
                csrf.current = session.csrf;
                setPassword("");
                await refresh();
                setAuth("ready");
              });
            }}
          >
            <label htmlFor="password">管理員密碼</label>
            <input
              id="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
              maxLength={512}
              disabled={busy}
            />
            <button className="primary" disabled={busy}>
              {busy ? "正在登入…" : "登入管理後台"}
              <ArrowRightIcon />
            </button>
          </form>
        </section>
      ) : null}
      <p className={`notice ${notice.error ? "error" : ""}`} role="status">
        {notice.text}
      </p>
      {auth === "ready" && (
        <fieldset className="admin-controls" disabled={busy} aria-busy={busy}>
          <div className="admin-heading">
            <div>
              <p className="eyebrow">YOUR MUSIC, YOUR PACE</p>
              <h1>歌曲管理</h1>
              <p className="muted">
                先收藏，再開放。每一首歌，由你決定登場時間。
              </p>
            </div>
            <div className="header-actions">
              <button
                className="outline"
                onClick={() =>
                  run(async () => {
                    await refresh();
                    setNotice({ text: "題庫已更新。" });
                  })
                }
              >
                重新整理
              </button>
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await api("logout", { method: "POST", body: "{}" });
                    clearAuth();
                    setNotice({ text: "已登出。" });
                  })
                }
              >
                登出
              </button>
            </div>
          </div>
          <div className="stats">
            <div>
              <span>題庫總數</span>
              <strong>{songs.length}</strong>
            </div>
            {Object.entries(statusLabels)
              .sort(
                ([a], [b]) =>
                  ["published", "draft", "archived"].indexOf(a) -
                  ["published", "draft", "archived"].indexOf(b),
              )
              .map(([key, label]) => (
                <div key={key}>
                  <span>{label}</span>
                  <strong>
                    {songs.filter((s) => s.status === key).length}
                  </strong>
                </div>
              ))}
          </div>
          <p className="library-hint">
            只有「已開放」的歌曲會出現在前台。每個遊戲分類至少需要 5
            首，才能開始一輪。
          </p>
          <div className="admin-tabs" role="tablist" aria-label="歌曲管理功能">
            {[
              ["library", "我的題庫"],
              ["discover", "搜尋 Apple 曲庫"],
            ].map(([key, label], i) => (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`${key}-tab`}
                role="tab"
                aria-selected={tab === key}
                aria-controls={`${key}-panel`}
                tabIndex={tab === key ? 0 : -1}
                onKeyDown={(event) => tabKey(event, i)}
                onClick={() => {
                  setTab(key);
                  setNotice({ text: "" });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <section
            id="library-panel"
            role="tabpanel"
            aria-labelledby="library-tab"
            hidden={tab !== "library"}
          >
            <div className="filters">
              <label>
                搜尋題庫
                <input
                  type="search"
                  value={query}
                  onChange={(e) => filter(setQuery, e.target.value)}
                  placeholder="歌名、歌手或專輯"
                />
              </label>
              <Select
                label="歌曲狀態"
                value={status}
                onChange={(v) => filter(setStatus, v)}
                options={{ all: "所有狀態", ...statusLabels }}
              />
              <Select
                label="分類"
                value={category}
                onChange={(v) => filter(setCategory, v)}
                options={{ all: "所有分類", ...categoryLabels }}
              />
              <Select
                label="曲庫類型"
                value={region}
                onChange={(v) => filter(setRegion, v)}
                options={{ all: "所有曲庫", ...regionLabels }}
              />
            </div>
            <div className="batch">
              <SelectionCheckbox
                checked={
                  visible.length > 0 && visible.every((s) => selected.has(s.id))
                }
                mixed={
                  selected.size > 0 && !visible.every((s) => selected.has(s.id))
                }
                onChange={(e) =>
                  setSelected(
                    new Set(
                      e.target.checked
                        ? visible.slice(0, 200).map((s) => s.id)
                        : [],
                    ),
                  )
                }
              >
                全選目前列表
              </SelectionCheckbox>
              <span>已選 {selected.size} 首</span>
              {[
                ["published", "開放歌曲"],
                ["draft", "移回草稿"],
                ["archived", "下架"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={`small-button ${key === "published" ? "publish" : ""}`}
                  disabled={!selected.size}
                  onClick={() =>
                    patch({ status: key }, `為「${statusLabels[key]}」`)
                  }
                >
                  {label}
                </button>
              ))}
              <Select
                className="batch-category"
                label="改分類"
                value={batchCategory}
                onChange={setBatchCategory}
                options={categoryLabels}
              />
              <button
                className="small-button"
                disabled={!selected.size}
                onClick={() => patch({ category: batchCategory }, "的分類")}
              >
                套用分類
              </button>
              <Select
                className="batch-category"
                label="改曲庫類型"
                value={batchRegion}
                onChange={setBatchRegion}
                options={regionLabels}
              />
              <button
                className="small-button"
                disabled={!selected.size}
                onClick={() => patch({ region: batchRegion }, "的曲庫類型")}
              >
                套用曲庫
              </button>
            </div>
            <div className="management-list">
              {visible.map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  checked={selected.has(song.id)}
                  onSelect={(id, checked) => select(setSelected, id, checked)}
                  onPreview={setPreview}
                />
              ))}
            </div>
            {!visible.length && (
              <p className="empty">
                沒有符合條件的歌曲。調整篩選，或到 Apple 曲庫找一些新歌。
              </p>
            )}
            <p className="small muted">
              顯示 {visible.length} / {songs.length} 首，每批最多操作 200 首
            </p>
          </section>
          <section
            id="discover-panel"
            role="tabpanel"
            aria-labelledby="discover-tab"
            hidden={tab !== "discover"}
          >
            <div
              className="discovery-sources"
              role="group"
              aria-label="選曲來源"
            >
              {Object.entries({
                search: "搜尋歌名／歌手",
                mandopop: "台灣熱門・華語",
                kpop: "台灣熱門・K-POP",
              }).map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={source === key}
                  onClick={() => changeSource(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {source !== "search" ? (
              <div className="chart-heading">
                <div>
                  <h2>
                    {source === "mandopop" ? "台灣熱門・華語" : "台灣熱門・K-POP"}
                  </h2>
                  <p>
                    Apple Music 台灣 Top 100，依曲風分類，保留總榜名次。
                  </p>
                  <p className="small muted">{chartTime}</p>
                </div>
                <button
                  className="outline"
                  onClick={() => run(() => loadChart(source))}
                >
                  重新載入
                </button>
              </div>
            ) : (
              <>
                <form
                  className="search-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      setDiscoveryMessage("正在搜尋 Apple 曲庫…");
                      setResults([]);
                      setImportSelected(new Set());
                      try {
                        const matches = await api(
                          `search?q=${encodeURIComponent(appleQuery.trim())}`,
                        );
                        setResults(matches);
                        setDiscoveryMessage(
                          matches.length
                            ? `找到 ${matches.length} 首可試聽歌曲。匯入後會放在草稿，不會自動開放。`
                            : "找不到可試聽的歌曲，試試其他歌名或歌手。",
                        );
                      } catch (error) {
                        setDiscoveryMessage("搜尋未完成，請稍後再試。");
                        throw error;
                      }
                    });
                  }}
                >
                  <label htmlFor="apple-query">Apple 台灣曲庫</label>
                  <div>
                    <input
                      id="apple-query"
                      type="search"
                      value={appleQuery}
                      onChange={(e) => setAppleQuery(e.target.value)}
                      required
                      maxLength={100}
                      placeholder="例如：BTS、NewJeans、Supernova"
                    />
                    <button className="primary">
                      搜尋歌曲 <ArrowUpRightIcon />
                    </button>
                  </div>
                </form>
                <p className="small muted">
                  每次最多顯示 100
                  筆有試聽的結果，可用歌名縮小範圍。不同專輯版本會各自列出，匯入前可先試聽。
                </p>
              </>
            )}
            <div className="batch">
              <SelectionCheckbox
                checked={
                  available.length > 0 &&
                  available.every((s) => importSelected.has(s.id))
                }
                mixed={
                  importSelected.size > 0 &&
                  !available.every((s) => importSelected.has(s.id))
                }
                onChange={(e) =>
                  setImportSelected(
                    new Set(e.target.checked ? available.map((s) => s.id) : []),
                  )
                }
              >
                全選可匯入歌曲
              </SelectionCheckbox>
              <span>已選 {importSelected.size} 首</span>
              <Select
                className="batch-category"
                label="匯入分類"
                value={importCategory}
                onChange={setImportCategory}
                options={categoryLabels}
              />
              <Select
                className="batch-category"
                label="匯入曲庫類型"
                value={importRegion}
                onChange={setImportRegion}
                options={{
                  other: regionLabels.other,
                  tw: regionLabels.tw,
                  kr: regionLabels.kr,
                }}
              />
              <button
                className="small-button publish"
                disabled={!importSelected.size}
                onClick={() =>
                  run(async () => {
                    const result = await api("import", {
                      method: "POST",
                      body: JSON.stringify({
                        ids: [...importSelected],
                        category: importCategory,
                        region: importRegion,
                      }),
                    });
                    await refresh();
                    setNotice({
                      text: `已加入 ${result.imported} 首草稿${result.skipped ? `，${result.skipped} 首已存在或無法匯入` : ""}。到「我的題庫」選擇要開放的歌曲。`,
                    });
                  })
                }
              >
                加入草稿
              </button>
            </div>
            <p className="small muted">
              {source === "search"
                ? "請選擇匯入曲庫；「其他／待分類」不會出題。"
                : "依 Apple 曲風預選曲庫，仍可手動調整。K-POP 可能包含英文作品。"}
            </p>
            <p className="empty" role="status">
              {discoveryMessage}
            </p>
            <div className="management-list">
              {results.map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  discovery
                  checked={importSelected.has(song.id)}
                  onSelect={(id, checked) =>
                    select(setImportSelected, id, checked)
                  }
                  onPreview={setPreview}
                />
              ))}
            </div>
          </section>
        </fieldset>
      )}
      {preview && (
        <AdminPreview
          song={preview}
          onClose={() => setPreview(null)}
          onError={(text) => setNotice({ text, error: true })}
        />
      )}
    </div>
  );
}
