# Music Challenge

可自行部署的繁體中文華語／K-POP 猜歌網站。React + Vite App Shell，Node.js 24 + SQLite，前後端分開建置，適用 Docker Compose 或 Zeabur 兩個服務部署。前台 `/`、排行榜 `/leaderboard`、好友對戰 `/duel`；管理後台獨立於 `/admin`，玩家導覽不顯示歌曲管理。不需要 ChatGPT 帳號或 Sites。

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
- `docker/nginx.conf.template`：同源 API 代理，保留 Origin、Cookie 與 CSRF header。房間使用 SSE，關閉 proxy buffering，15 秒心跳配合 75 秒代理讀取逾時。後端重新建容器時，Nginx 會重新解析內網 DNS。

在專案目錄複製 `.env.example` 為 `.env`，先設定至少 16 字元的 `ADMIN_PASSWORD`，再執行：

```sh
docker compose up -d --build --wait
```

前台 http://127.0.0.1:8090 ，後台 http://127.0.0.1:8090/admin 。使用 `.env` 的管理員密碼登入，首次 35 首種子歌全為草稿；任一模式至少 1 首即可開始，經典每輪最多 5 首，不足時按實際不同歌曲數出題。這份 Docker 資料庫獨立於先前 `data/preview` 的本機試玩資料。

```sh
docker compose ps
docker compose logs -f frontend backend
docker compose down
```

`down` 保留資料 Volume；**不要加 `-v`**，那會刪除歌曲、開放狀態、玩家身分、遊戲紀錄及排行榜。更新程式再次執行 `docker compose up -d --build --wait` 即可。

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
- `src/components/AppShell.jsx` 是共用外框；React Router 管理 `/`、`/leaderboard`、`/duel`、`/duel/:code` 和 `/admin`，內部導航不整頁重載。玩家頁保留安全區並以分步與分頁保持主要操作可見。
- `src/pages/GamePage.jsx` 管理單人經典／無限流程；`DuelPage.jsx` 管理邀請房與即時狀態；`LeaderboardPage.jsx` 顯示分頁排行榜。`GuessInput.jsx` 管理 autocomplete；`PreviewPlayer.jsx` 管理音訊生命週期。
- `game-service.mjs` 在伺服器選曲、判斷答案、計分並保存遊戲狀態。瀏覽器提交操作與 revision，不能直接提交分數；衝突後重新讀取狀態，避免重複結算。
- `src/pages/AdminPage.jsx` 延遲載入，處理登入、熱門榜、曲庫與開放狀態。權限仍由 Node.js API 驗證，不以隱藏畫面取代權限檢查。
- Docker 模式下 Nginx 提供 HTML 和 Vite 靜態資源，`server.mjs` 僅提供 `/api/*`。本機 `npm start` 保留網頁服務能力；`SERVE_STATIC=false` 可關閉。API 錯誤及不存在的靜態檔案不會誤回 HTML。
- `dist/` 是可重建的輸出，請修改 `src/`，不要手動修改 `dist/`。字體、圖示及品牌 SVG 由本站提供，不依賴外部 JavaScript CDN。
- 支援系統明暗偏好與手動切換。此版本是可安裝的 SPA／PWA App Shell；service worker 提供離線提示，音訊與遊戲 API 仍需網路，不建立離線音訊或登入資料快取。
- 檢查：`npm run check`、`npm run build`、`npm test`。測試包含 Node.js API／SQLite 遷移與 React 元件互動。

## 前台分類與輸入答題

- 玩家只能選「華語」或「K-POP」其中一種，預設 K-POP；再選「男女合併」、「女聲／女團」或「男聲／男團」。經典模式通常抽 5 首；無限挑戰持續抽下一首，不混合兩種曲庫。不同專輯的同歌名同歌手會去重，實際題數由可用的不同歌曲決定。
- 輸入歌名或歌手，autocomplete 會搜尋**本輪所選分類的已開放題庫**，最多列出 8 首建議，每頁 2 首；不查詢整個 Apple 曲庫，不會洩漏草稿或下架歌曲。可繼續輸入縮小範圍。
- 完整歌名唯一匹配時會自動填入正式名稱並選取歌曲，仍需按送出確認；同名但不同歌手時保留建議供選擇。中文輸入法組字期間不自動選取或送出。
- 公開 `/api/catalog` 只回傳 `id,title,artist,year,category,region`，試聽與歌曲完整資訊由本輪狀態提供。遊玩操作保留題庫、暱稱及設定的短期記憶體快取；完成遊戲更新排行榜、後台編輯重新取得題庫。好友對戰與派對並行取得題庫及訪客資料，搜尋索引依曲庫建立一次，不隨每次作答重建。
- Apple 試聽的下載與回應內容超過 20 秒會取消並提供重新載入，不自動重送作答或代管音源。
- 點選建議，或以方向鍵與 Enter 選歌，再按「送出答案」。也可以直接輸入完整歌名送出。
- 手動歌名比對忽略大小寫、空白、標點與全半形差異，必須是完整歌名；不做錯字猜測或中韓文譯名轉換。選擇建議時，同歌名同歌手的不同專輯版本視為同一答案，同名不同歌手則不算。
- 每題使用下方片段計分；也可直接揭曉，並查看歌曲資訊與 Apple Music 連結。

## 播放與片段計分

固定 App-shell 頁首與功能導覽，手機使用底部導覽。玩家畫面以固定可視區、分步設定與分頁呈現，避免依賴整頁捲動；管理後台仍保留列表操作所需的內容捲動。首頁以粉紅唱盤與旋轉黑膠取代照片。遊戲唱片只在實際播放時旋轉；減少動態偏好下停用旋轉。

每次由玩家按播放，從試聽的 0 秒播放至已解鎖上限後自動停止；不循環、不自動重播，也不能拖曳或快轉。重播、暫停與思考時間不扣分；答錯或按「延長片段」才進入下一段。最後一段答錯才結算 0 分；直接揭曉也為 0 分。每題至少成功播放一次才可猜。

| 解鎖長度 | 答對分數 |
| --- | --- |
| 1 秒 | 1,000 |
| 6 秒 | 800 |
| 12 秒 | 600 |
| 18 秒 | 400 |
| 24 秒 | 200 |
| 完整試聽 | 100 |

完整長度以瀏覽器解碼後回報的音源為準，伺服器接受 0.1 至 90 秒，不假設每首都是 30 秒。短片段在第一個到達完整長度的級距結束，例如 8 秒音源只有 1／6／8 秒，對應 1000／800／600 分。標準 5 題經典模式滿分 5000；無限挑戰沒有固定總題數，可主動結束並保存已完成題目的成績。

`src/lib/clip-audio.js` 使用 Web Audio `AudioBufferSourceNode.start(0, 0, duration)` 控制單次播放邊界，`loop=false`，UI 更新延遲不會讓音訊播放到未解鎖區域。Apple 試聽於瀏覽器記憶體解碼，不儲存或代理音檔。Node 與 Nginx CSP 的 connect-src 僅加入既有 Apple 音源網域。離開頁面、隱藏分頁、揭曉或切換歌曲會取消待播放請求並停止音訊；載入錯誤可重試。

伺服器計分規則與狀態機位於 `game-service.mjs`，前端 `src/lib/game-logic.js` 保留級距與曲庫／搜尋輔助函式。分數由伺服器產生，客戶端提供的 score 欄位不採用。

## 無限挑戰、排行榜與好友對戰

- **無限挑戰**：同一輪歌單內不重複；符合條件的不同歌曲全部抽完才重新洗牌，多於一首時避免洗牌前後連續出現同一首。主動結束會保存已完成題目的分數，未作答題目不列入完成數。頁面重新整理可用該分頁保留的 run ID 接回遊戲。
- **排行榜**：`/leaderboard` 區分經典／無限，可按曲庫篩選，採分頁呈現。每個訪客身分在目前篩選下只列最高成績；完成一輪或主動結束後入榜。暱稱不是唯一帳號，排行榜不屬於驗證身分或具有完整防作弊保證的競賽排名。
- **建立房間**：A 在 `/duel` 設定曲庫、年代、演唱分類與經典／無限，建立後複製 `/duel/:code` 邀請連結。B 開啟連結、確認暱稱並主動加入；最多兩位，加入後開始第一題。
- **相同題目、各自作答**：雙方取得同一首音源，各自解鎖與猜歌。先完成者等待；在兩人都完成前，不揭曉答案或本題分數，也不更新任何一方顯示的累積分數。兩人完成後顯示本題分數，再以短動畫轉為累積分數；降低動態偏好下直接顯示穩定結果。
- **下一首與結算**：逐題揭曉後，左側「結束」、右側「準備」；雙方都準備好才進入下一首。任一模式皆可主動結束，確認後保留已完成作答的得分並進入結算；另一方先收到「{名稱} 已結束對戰，請查看分數。」通知，按確認再查看結算與分享戰果。未完成作答不得分，雙方皆未作答的新題不計入完成題數。斷線本身不會自動判輸或結束，原瀏覽器重新連線可恢復座位。

`music_player` Cookie 使用 HttpOnly、SameSite=Strict 與 400 天有效期；正式環境須 HTTPS。只有 `GET /api/player` 會建立身分，公開設定、曲庫、排行榜與邀請房預覽不會改寫 Cookie。資料庫只保存 token 雜湊。清除 Cookie、無痕模式結束或更換瀏覽器會成為新玩家；目前沒有登入帳號、跨裝置同步或身分找回。

房間事件透過同源 `GET /api/rooms/:code/events` SSE 傳送，操作使用 JSON POST。SSE 會重連並立即回傳完整當前狀態；連線數決定顯示的在線狀態，座位與題目仍保存在 SQLite。需維持一個後端副本，因事件連線位於該程序記憶體；重啟後玩家可重連讀取持久狀態。其他反向代理也須關閉 SSE 緩衝，並容許 15 秒心跳的長連線。

無限模式單人保留最近 50 筆作答明細，房間保存最近 100 筆玩家作答紀錄；總分、完成題數與答對數獨立累積，不因裁減歷史而減少。正在遊玩的歌曲資料保留開局快照；後台下架歌曲只影響新開的遊戲。

## 公開成績分享

完成單人挑戰或雙人房間後，可建立公開成績頁 `/result/:id`。`POST /api/results` 只接受 `{ sessionId }`，必須使用原本的玩家 Cookie 與本站來源；伺服器確認已結束且玩家擁有該單人遊戲或參與該房間，從 SQLite 產生成績，不採用前端傳入的分數。

同一場遊戲與同一位玩家重複建立會得到同一份收據；網址使用隨機識別碼，內容保存為不可變快照，重新部署仍可開啟。`GET /api/results/:id` 不需登入，也不建立玩家 Cookie。頁面資料只包含暱稱、模式與分類、總分、答對／完成題數、雙方成績及勝負；不含歌名答案、音源、原房間／遊戲編號、玩家 ID 或登入憑證。每份收據最多包含最近 20 題分數，`roundScoresTotal` 與累積成績仍反映全部完成題數。

後端與 Nginx 皆支援 `/result/:id` 直接開啟，並為 PWA 提供 `/manifest.webmanifest`、`/sw.js`、`/offline.html`、`/offline.css`、`/icons/*`。Manifest 使用 `application/manifest+json`，service worker 使用 JavaScript MIME 與 no-cache；API 回應仍為 no-store，不由後端建立離線 API 快取。CSP 的 `worker-src 'self'` 允許本站 worker，`img-src blob:` 用於瀏覽器產生的分享圖片預覽，不放寬腳本來源。

## 贊助按鈕

頁尾「試聽來源：Apple iTunes」同一列最右側顯示淡粉色愛心「Donate Me!」按鈕，另開分頁前往 `https://portaly.cc/bradydamove`。連結設定於 `src/components/AppShell.jsx`，不需要環境變數；本站不處理付款。手機版保留試聽來源與 App 安裝／更新入口，不換行。

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

## Live／Feat 版本過濾

排行榜、Apple 搜尋、匯入、開放與公開題庫共用 `excludedVersionReason` 規則。歌曲或專輯中明確的 Live／現場版本標記，以及歌名或演唱者欄位的 feat./ft./featuring 標記會被排除。總榜名次保留，不重新編號。一般多人合唱、`Still Alive`、`Believe`、`Live Forever` 等名稱不會因字串片段被排除；未標示的合作曲不以歌手人數推斷。既有符合歌曲下架並保留紀錄與排除原因。

## 資料與備份

`DATA_DIR/songs.sqlite` 保存歌曲與開放狀態、管理員登入、訪客身分、進行中的單人／房間狀態、排行榜與公開成績收據。第一次初始化才匯入 `seeds/catalog.json`，重新部署不會把狀態重設為草稿。

正式備份請使用 Zeabur Volume 備份，或先停止服務再備份整個 `/data` 目錄，包含 SQLite WAL 相關檔案。還原時先停止服務，把資料恢復到同一掛載目錄，再啟動。不要在服務運行時只複製主 `.sqlite` 檔案。

管理員登入以 SQLite 持久工作階段保存，不設定自動到期或數量淘汰；重啟與重新部署後仍保持登入。資料庫只保存登入 token 的雜湊，Cookie 使用 HttpOnly / SameSite 並保留同來源與 CSRF 檢查。瀏覽器 Cookie 設定 400 天有效期，每次通過驗證的後台 API 請求會續期；清除瀏覽器資料、隱私模式關閉、瀏覽器自行移除 Cookie 或長期未使用仍可能需要重新登入。主動登出會從資料庫撤銷該次登入。正式模式 Cookie 需要 HTTPS。登入失敗有速率限制；反向代理後的管理員共用此額度。更換密碼並重新部署後，原有登入工作階段會失效。

## 音源

後台從 Apple iTunes Search API 搜尋及匯入台灣商店曲目。每次 Apple 查詢至少間隔約 3 秒。只保存歌名、歌手、專輯、年份、封面網址、試聽網址及商店連結；不下載、快取或重新代管音訊與封面。

`npm run catalog` 是選用的 Python 種子清單更新工具，只改動 `seeds/catalog.json`，不會修改已建立的資料庫。日常管理使用後台即可，部署容器不需要 Python。

播放器由使用者點擊啟動，直接向 Apple 讀取試聽片段並在瀏覽器記憶體解碼。試聽長度與起點由 Apple 決定，並非歌曲完整音源。供應可能隨地區或時間變動，失效時可以重試、跳題或重新更新題庫。

玩家輸入歌名或透過 autocomplete 選歌，依已解鎖片段級距得分；重播與思考時間不扣分。答案揭曉後顯示歌曲資料及 Apple Music 連結。暱稱、累積成績與進行中的遊戲保存在本站 SQLite，不需要外部帳號。

## 驗證

### 年代選曲

前台可選不限年代、2000–2009、2010–2019、2020–2029，與華語／K-POP、演唱分類交集篩選；經典每輪最多 5 題，不足時縮短；無限挑戰至少 1 首即可開始。年份未知只會出現在不限年代。

後台題庫可依年代篩選、搜尋年份並逐首修正發行年（留白表示未知）。Apple 搜尋及當期榜單可依年代或單一年份篩選本次回傳的結果；這不是完整年代曲庫，也不是歷史熱門排名。Apple 年份可能對應再版／精選輯，需要時由管理員改成原曲年份；匯入既有歌曲不會覆蓋修正。

年代熱門題庫需要另外選定歌單或歷年台灣榜單來源，再比對 Apple 台灣曲庫的試聽版本。目前未接入歷史排行榜。

```sh
npm run check
npm run build
npm test
```

整合測試使用臨時資料庫，驗證未授權存取、草稿隔離、開放／下架、CSRF、匯入去重、重新啟動資料保留及登出；另涵蓋獨立訪客 cookie、同源操作、SSE、雙方完成／準備屏障、重複操作拒絕、無限曲序與累積成績持久保存。測試中的 Apple 回應使用隔離的 fixture，不需呼叫外部平台。

## 安裝 App 與分享戰果

App 名稱固定為 **Music Challenge**，採用黑膠與粉紅搶答鈴圖示。`npm run icons` 可重新產生一般、maskable、Apple touch icon 及社群封面；`npm run build` 會產生版本化的 service worker，Docker 前端建置已包含此步驟。

正式網站需使用 HTTPS。首頁頁尾「安裝 App」會開啟支援瀏覽器的安裝提示，或顯示手動加入主畫面的步驟；iPhone 使用 Safari 的分享選單 → 加入主畫面。安裝後猜歌、對戰及讀取戰果仍需網路，斷線會顯示離線提示。更新按鈕只在非遊玩畫面出現，並先檢查其他分頁是否仍在挑戰。

結算後按「分享戰果」建立公開成績頁，可複製網址、下載 1080 × 1350 PNG，或在支援檔案分享的手機瀏覽器呼叫系統分享選單。圖片預覽與匯出為同一份內容；不支援系統分享時仍可下載及複製。localhost 產生的網址只供本機測試，部署後會自動使用正式網域。

## 派對模式

開啟 `/party`，主控選好曲庫並建立房間，朋友掃描 QR Code 或開啟邀請連結加入。每場最多 50 位參賽者（不含主控），開始後停止接受新玩家；原本的玩家可以重新連線回到房間。

只有主控播放 Apple 完整試聽，不採用單人模式的片段級距，也不自動循環。主控按播放後開放搶答，答錯可繼續輸入，答對或放棄後等待本題結束。音樂播完仍能猜；全員答對／放棄，或主控按揭曉後才結束本題。主控可手動重播、切換下一首、或結束整場。

伺服器依收到正確答案的順序決定名次：每題第一名 1,000 分、第二名 900 分，每名遞減 100 分，第十名以後都是 100 分；放棄或未答對為 0 分。結算依累積分數排序，同分時依猜中首數、答對名次總和、加入順序排序。結算畫面包含前三名頒獎台、所有參賽者的分頁排名與短暫煙火；減少動態效果時不播放煙火。可建立公開戰果頁、下載 PNG 或使用手機分享。

本機測試時，QR Code 會使用可用的區域網路位址，手機與電腦需位於相同網路，並允許既有服務的防火牆連線。若電腦有多張網卡，請選擇手機可連線的位址。正式部署直接使用網站網域。Docker 前端代理 SSE，後端 SQLite 資料卷保存房間與戰果。50 位玩家的並行 HTTP／SSE 測試在本機通過，尚未代表目標伺服器的容量測試。

## 房間逾時與連線清理

派對新客戶端使用 `/events?compact=1`：首次／重連送完整 `state`，後續 `patch` 僅包含變動欄位、玩家欄位差異與必要的排名順序；結束時仍送完整狀態。每條連線保留自己的基準版本，允許其他玩家答錯時跳過無關通知，也能在同一版本更新主持人在線狀態。基準不符會要求重新連線，不套用不完整的排名。未指定 compact 的舊客戶端維持完整狀態協定，新客戶端也能連接舊後端。

派對固定題庫儲存在 `party_catalogs`，`game_states` 僅保存動態欄位和牌組 ID；成功操作仍在同一 SQLite 交易內同步提交後才廣播，維持搶答順序與重啟後分數。既有房間讀取時相容舊格式，第一次成功寫入才原子轉換。最多快取 32 個不可變房間題庫，不快取可變分數。此為儲存格式升級，部署前依上方方式備份；回退到不認識 `storageVersion: 2` 的舊後端時需同步還原升級前資料，不能只回退映像。

可重跑的負載腳本與限制見 [壓力測試方式](docs/load-testing.md)。本機新舊版比較使用隔離資料庫及相同 558 首合成題庫，與正式站網路壓測分開判讀。

好友對戰及派對在 10 分鐘內沒有成功的遊戲操作（加入、播放、作答、放棄、準備或下一首等），會自動結算。好友對戰任一玩家的所有分頁離線，或派對主控的所有分頁離線超過 2 分鐘，也會自動結束。派對參賽者離線不會單獨結束整場。伺服器每 10 秒檢查一次；心跳、讀取狀態及無效操作不延長閒置期限。啟動後仍沿用 SQLite 保存的最後操作時間，連線重建另有 2 分鐘寬限。

自動結算保留已取得的分數及分享能力，不刪除房間或戰果資料。伺服器送出最後狀態後立即關閉 SSE，已結束房間的串流請求回傳 HTTP 204，避免自動重連。兩種模式每名玩家最多 4 條連線，並限制慢速連線的待送資料量。

前端切離房間會關閉 SSE 並取消尚未完成的操作；共用資料請求在最後一個使用者離開後，保留 250 毫秒供下一頁接手，沒有接手就取消下載。斷線或收不到心跳超過 2 分鐘會停止重連，顯示「重新連線」，由使用者重新讀取房間狀態。

PWA／瀏覽器進入背景時也會釋放房間連線；回到前景且尚未逾時時，建立新連線取得最新狀態。背景計時器即使被系統暫停，恢復時仍以實際經過時間判斷期限；已逾時則提供手動重新連線，切離房間後不會因 App 恢復前景重新開啟舊連線。

## 原型用途

本專案不代表已取得 Apple 對猜歌用途的許可。宣傳展示、來源標示及商店連結並不自動排除 Apple 條款對獨立娛樂用途的限制；對外正式上線前仍需確認適用授權。

- https://performance-partners.apple.com/search-api
- https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html
- https://rss.marketingtools.apple.com/
