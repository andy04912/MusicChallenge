# Music Challenge

可自行部署的繁體中文華語／K-POP 猜歌網站。React + Vite App Shell，Node.js 24 + SQLite，前後端分開建置，適用 Docker Compose 或 Zeabur 兩個服務部署。前台 `/`，管理後台 `/admin`。不需要 ChatGPT 帳號或 Sites。

## 本機啟動

1. 安裝 Node.js 24。
2. 複製 `.env.example` 為 `.env`。
3. 將 `ADMIN_PASSWORD` 改為至少 16 字元的獨立密碼。
4. 執行 `npm ci` 安裝鎖定版本的套件。
5. 執行 `npm run dev`，開啟 http://127.0.0.1:5173 。此指令同時啟動 Vite 與 Node.js API，開發環境固定使用 5173 / 8080。
6. 測試正式建置：`npm run build` 後執行 `npm start`，開啟 http://127.0.0.1:8080 。

後台使用 `.env` 中的密碼登入，不需要設定帳號。請勿提交 `.env` 到 Git。

## Docker：前後端分離

- `Dockerfile.frontend`：Node 建置 React → Nginx 提供網頁，將 `/api/*` 轉送給後端。
- `Dockerfile.backend`：Node.js API + SQLite，不包含前端檔案、不需要 npm install，以 node 使用者執行。
- `compose.yaml`：啟動兩個服務；只公開前端，後端透過容器內網連接。SQLite 使用 `songs-data` named volume。
- `docker/nginx.conf.template`：同源 API 代理，保留 Origin、Cookie 與 CSRF header。後端重新建容器時，Nginx 會重新解析內網 DNS。

在專案目錄複製 `.env.example` 為 `.env`，先設定至少 16 字元的 `ADMIN_PASSWORD`，再執行：

```sh
docker compose up -d --build --wait
```

前台 http://127.0.0.1:8090 ，後台 http://127.0.0.1:8090/admin 。使用 `.env` 的管理員密碼登入，首次 35 首種子歌全為草稿，開放至少 5 首才能遊玩。這份 Docker 資料庫獨立於先前 `data/preview` 的本機試玩資料。

```sh
docker compose ps
docker compose logs -f frontend backend
docker compose down
```

`down` 保留資料 Volume；**不要加 `-v`**，那會刪除歌曲與開放狀態。更新程式再次執行 `docker compose up -d --build --wait` 即可。

| 設定 | 本機預設／用途 |
| --- | --- |
| `ADMIN_PASSWORD` | 必填，至少 16 字元，不能使用範例值 |
| `FRONTEND_PORT` | `8090`，避免與 `npm start` 的 8080 衝突 |
| `BIND_ADDRESS` | `127.0.0.1`，只在本機提供存取 |
| `APP_ENV` | `development`，本機 HTTP；公開 HTTPS 部署必須改為 `production` |
| `APP_ORIGIN` | 預設 `http://127.0.0.1:FRONTEND_PORT`；網址的協定、主機、埠必須與瀏覽器一致 |

本機請用 `127.0.0.1`，若改用 `localhost`，也將 `APP_ORIGIN` 改成對應網址再重建服務。正式自架時在前端前方提供 HTTPS、設定 `APP_ENV=production` 和正式 `APP_ORIGIN`；依反向代理位置調整 `BIND_ADDRESS`。Compose 中後端埠不對主機公開。

兩個 Dockerfile 的 **build context 都是本專案根目錄**：

```sh
docker build -f Dockerfile.frontend -t seoul-signal-frontend .
docker build -f Dockerfile.backend -t seoul-signal-backend .
```

## 在 Zeabur 部署兩個服務

將同一 repository 加入同一個 Zeabur project 兩次，分別命名 `frontend`、`backend`。兩者 Root Directory 都設為 `seoul-signal`；如果 repository 根目錄就是本專案內容，則留空。

| 服務 | 建置設定 | 執行環境變數 |
| --- | --- | --- |
| backend | `ZBPACK_DOCKERFILE_NAME=backend` | `ADMIN_PASSWORD`、`NODE_ENV=production`、`PORT=8080`、`DATA_DIR=/data`、`SERVE_STATIC=false`、`APP_ORIGIN=https://前端網域` |
| frontend | `ZBPACK_DOCKERFILE_NAME=frontend` | `PORT=8080`、`API_UPSTREAM=http://後端內網主機:8080` |

`ZBPACK_DOCKERFILE_NAME` 填 **frontend / backend 後綴**，不是完整檔名。`API_UPSTREAM` 使用後端私有網路的完整 DNS 名稱，**不加尾斜線或 `/api`**，不能填 localhost。Zeabur 上使用 `service-<serviceId>.environment-<environmentId>.zeabur.internal`；Nginx 的動態 resolver 不會補上系統 DNS search suffix，只填短主機名會造成 502。實際設定見 `DEPLOYMENT.md`。

只替 frontend 綁定公開網域／HTTPS；backend 不需要公開網域。後端 `APP_ORIGIN` 填前端完整公開來源，不加路徑或尾斜線，否則後台登入會被拒絕。前端沒有 `VITE_API_URL` 或管理員密碼，所有瀏覽器 API 請求固定走同源 `/api`。

在 backend 掛載持久 Volume 到 `/data`，確保 UID/GID `1000:1000`（node 使用者）可以寫入。SQLite 必須維持單一後端副本；前端不掛載資料 Volume。API 健康檢查 `/api/health`，前端健康檢查 `/healthz`。

Zeabur 不直接執行本專案的 Compose YAML；請依上面的兩個服務設定部署。[Zeabur Dockerfile 官方文件](https://zeabur.com/docs/en-US/deploy/methods/dockerfile) · [Volume 文件](https://zeabur.com/docs/en-US/data-management/volumes)。目前部署紀錄見 `DEPLOYMENT.md`。

## App Shell 架構

- `index.html` 只有 root 容器與入口載入，頁首、導覽、頁尾、首頁、答題及後台由 React 元件渲染。
- `src/components/AppShell.jsx` 是共用外框；React Router 管理 `/` 和 `/admin`，內部導航不整頁重載。猜歌各階段由 React state 管理。
- `src/pages/GamePage.jsx` 管理曲庫選曲、5 題流程、速度計分；`GuessInput.jsx` 管理 autocomplete；`PreviewPlayer.jsx` 管理音訊生命週期。
- `src/pages/AdminPage.jsx` 延遲載入，處理登入、熱門榜、曲庫與開放狀態。權限仍由 Node.js API 驗證，不以隱藏畫面取代權限檢查。
- Docker 模式下 Nginx 提供 HTML 和 Vite 靜態資源，`server.mjs` 僅提供 `/api/*`。本機 `npm start` 保留網頁服務能力；`SERVE_STATIC=false` 可關閉。API 錯誤及不存在的靜態檔案不會誤回 HTML。
- `dist/` 是可重建的輸出，請修改 `src/`，不要手動修改 `dist/`。字體、圖示及首頁圖片由本站提供，不依賴外部 JavaScript CDN。
- 支援系統明暗偏好與手動切換。此版本是 SPA App Shell，未加入 service worker 或離線音訊快取。
- 檢查：`npm run check`、`npm run build`、`npm test`。測試包含 Node.js API／SQLite 遷移與 React 元件互動。

## 前台分類與輸入答題

- 玩家只能選「華語」或「K-POP」其中一種，預設 K-POP；再選「男女合併」、「女聲／女團」或「男聲／男團」。每輪從符合條件的已開放曲目抽 5 首，不混合兩種曲庫。
- 輸入歌名或歌手，autocomplete 會搜尋**本輪所選分類的已開放題庫**，最多列出 8 首建議；不查詢整個 Apple 曲庫，不會洩漏草稿或下架歌曲。可繼續輸入縮小範圍。
- 點選建議，或以方向鍵與 Enter 選歌，再按「送出答案」。也可以直接輸入完整歌名送出。
- 手動歌名比對忽略大小寫、空白、標點與全半形差異，必須是完整歌名；不做錯字猜測或中韓文譯名轉換。選擇建議時，同歌名同歌手的不同專輯版本視為同一答案，同名不同歌手則不算。
- 每題使用下方速度計分；也可直接揭曉，並查看歌曲資訊與 Apple Music 連結。

## 播放與速度計分

左側使用品牌粉紅色唱片盤，黑膠只在音訊實際播放時旋轉，暫停、等待緩衝、結束或揭曉即停止。播放鍵在唱片下方；進度條僅顯示進度，不能拖曳／快轉。系統設定減少動態效果時停用旋轉。

首次 `playing` 事件開始計時；初次載入等待不計入。開始前不能輸入答案；暫停、重播、緩衝與切換分頁仍持續計時。每題只提交一次，送出時以實際經過毫秒計算，畫面每 0.1 秒更新僅供參考。下一題重設時鐘。

| 正確作答時間 | 分數 |
| --- | --- |
| ≤ 1 秒 | 1,000 |
| > 1 秒且 ≤ 3 秒 | 800 |
| > 3 秒且 ≤ 5 秒 | 600 |
| > 5 秒且 ≤ 10 秒 | 400 |
| > 10 秒且 ≤ 20 秒 | 200 |
| > 20 秒 | 100 |
| 答錯／直接揭曉 | 0 |

每輪 5 題、滿分 5,000。結果列出每題得分與作答秒數。分數規則位於 `src/lib/game-logic.js` 的 `scoreTiers`。目前是本機休閒遊戲計分，沒有線上排行榜或伺服器驗證分數。

## 逐步開放歌曲

- **曲庫類型**：匯入時指定「華語／K-POP／其他待分類」，或在「我的題庫」篩選並批次「套用曲庫」。華語依歌曲語言判斷，不限台灣歌手；K-POP 為獨立曲庫，由管理員人工分類，不能直接依榜單所在地推斷。其他／待分類不會出題。
- **既有資料相容**：資料庫保留 `region=tw/kr/other` 與 `category=girl/boy/other` 代碼，分別對應華語／K-POP／待分類與女聲／男聲／男女合唱，不重寫既有開放狀態。舊台灣曲庫請人工檢查是否為華語；原 Solo／其他需在後台批次歸入男聲或女聲，否則僅在男女合併出題。
- **既有資料升級**：啟動時自動增加歌曲地區欄位。已知的 35 首 K-pop 種子歌曲歸為 K-POP，先前其他匯入歌曲保留為待分類；不更改開放狀態，重啟不覆蓋手動分類。

- **台灣熱門・華語／台灣熱門・K-POP**：只讀 Apple Music 台灣 Top 100，依 Apple 曲風 ID 1253（華語流行樂）／51（韓國流行樂）分類，保留台灣總榜名次。不是韓國排行榜，也不是各分類獨立 Top 100。未標記這兩種曲風的歌曲不列入；K-POP 可能包含英文作品，分類可手動修正。兩類共用 30 分鐘快取。
- 排行榜歌曲以相同 Apple track ID 查詢台灣商店試聽；沒有對應試聽時顯示「暫無試聽」且不能匯入，不使用同名翻唱替代。已在題庫的歌曲會標示並避免重複勾選。每首歌會自動判斷演唱分類，並在該列提供修正選單。匯入曲庫自動預選華語或 K-POP，仍可更改；歌曲維持草稿，不會自動開放。
- **搜尋 Apple 曲庫**：輸入歌手或歌名，試聽後勾選歌曲，檢查各列的自動演唱分類，按「加入草稿」。每次最多 100 筆搜尋結果；用歌名縮小範圍。沒有試聽片段的歌曲不會列出。
- **我的題庫**：依歌名、歌手、專輯、狀態、分類篩選。勾選後批次「開放歌曲」、「移回草稿」、「下架」或修改分類。每批最多 200 首。
- **草稿**：準備中的歌曲，前台無法取得。
- **已開放**：前台可抽選，並用於選項。
- **已下架**：保留後台紀錄，停止加入新的遊戲。
- 每一輪開始都重新讀取已開放歌曲；已經進行中的一輪保留當時的題目。
- 重複匯入相同 Apple track ID 不會新增或覆寫原本狀態。不同專輯版本有不同 ID，管理員可自行挑選。
- 開放採手動操作，這版不包含定時排程或多管理員權限。

## 逐曲演唱分類

- 排行榜與搜尋結果逐曲回傳 `category`、`categoryReview`、`categorySource`、`categoryReason`。已知歌曲版本優先，其次解析該首的演唱者、歌名中的 feat./featuring/ft./with 合作名單；全部已知才分為男聲、女聲或男女合唱。
- 使用 `seeds/catalog.json` 的已確認歌曲與 `seeds/vocal-artists.json` 的演唱者別名資料；不是聲音辨識或即時 AI，也不根據姓名字形、國籍或音高猜測。資料涵蓋有限，未建檔歌手、未知合作人、混音／伴奏版本及混合團體的未確認歌曲會標為「待確認」。Apple 未列出的合作演唱者可能需要人工修正。
- 每列可選自動、男聲、女聲、男女合唱或待確認；只覆寫該首。匯入 API 的 `categories` 以 Apple track ID 為 key，未指定的曲目由後端重新判斷，不採信前端自動結果。匯入仍為草稿，重複 ID 不覆寫既有分類。
- 待確認以 `categoryReview=1` 保存，與已確認的男女合唱分開。可存草稿，不能開放，也不會進入男女合併遊戲。確認分類後才可手動開放。
- 既有歌曲的分類與開放狀態保持不變。可在該列選「自動判斷」，或勾選歌曲套用「逐曲自動判斷」。已開放歌曲若重新判斷成待確認，操作會拒絕並提示先移回草稿。

## 資料與備份

`DATA_DIR/songs.sqlite` 保存歌曲資料與開放狀態。第一次初始化才匯入 `seeds/catalog.json`，重新部署不會把狀態重設為草稿。

正式備份請使用 Zeabur Volume 備份，或先停止服務再備份整個 `/data` 目錄，包含 SQLite WAL 相關檔案。還原時先停止服務，把資料恢復到同一掛載目錄，再啟動。不要在服務運行時只複製主 `.sqlite` 檔案。

管理員登入使用 HttpOnly / SameSite Cookie、8 小時有效工作階段、同來源與 CSRF 檢查。正式模式 Cookie 需要 HTTPS。登入失敗有速率限制；反向代理後的管理員共用此額度。更換密碼並重新部署後，原有登入工作階段會失效。

## 音源

後台從 Apple iTunes Search API 搜尋及匯入台灣商店曲目。每次 Apple 查詢至少間隔約 3 秒。只保存歌名、歌手、專輯、年份、封面網址、試聽網址及商店連結；不下載、快取或重新代管音訊與封面。

`npm run catalog` 是選用的 Python 種子清單更新工具，只改動 `seeds/catalog.json`，不會修改已建立的資料庫。日常管理使用後台即可，部署容器不需要 Python。

播放器由使用者點擊啟動，直接串流 Apple 提供的片段。試聽長度與起點由 Apple 決定，並非歌曲完整音源。供應可能隨地區或時間變動，失效時可以重試、跳題或重新更新題庫。

每輪隨機五題，輸入歌名或透過 autocomplete 選歌，依作答速度得分，答案揭曉後顯示歌曲資料及 Apple Music 連結。成績只存在本次頁面記憶體，不收集帳號或分析資料。

## 驗證

```sh
npm run check
npm run build
npm test
```

整合測試使用臨時資料庫，驗證未授權存取、草稿隔離、開放／下架、CSRF、匯入去重、重新啟動資料保留及登出。測試中的 Apple 回應使用隔離的 fixture，不需呼叫外部平台。

## 原型用途

本專案不代表已取得 Apple 對猜歌用途的許可。宣傳展示、來源標示及商店連結並不自動排除 Apple 條款對獨立娛樂用途的限制；對外正式上線前仍需確認適用授權。

- https://performance-partners.apple.com/search-api
- https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html
- https://rss.marketingtools.apple.com/
