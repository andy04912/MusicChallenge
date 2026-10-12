# Seoul Signal 設計與遷移紀錄

## 設計判讀

給台灣與 K-pop 樂迷的音樂探索與猜歌網站。採保留品牌的局部改良，React + 原生 CSS token；不是第三方官方設計系統。DESIGN_VARIANCE 6、MOTION_INTENSITY 3、VISUAL_DENSITY 4。保留 wordmark、玫紅色、唱片主題、`/` 和 `/admin` 入口與原有功能。

## 原有介面稽核

- 原色：紙白 #f5f3ee、炭黑 #232321、玫紅 #c6275d。字體原為 Noto Sans TC 與 Barlow Condensed。按鈕約 5-6px 圓角、播放器 10px。
- 路徑：前台首頁 → 選分類 → 試聽與輸入作答 → 揭曉 → 5 題成績；後台登入 → 題庫／Apple 搜尋與熱門榜 → 草稿 → 手動開放。
- 保留：歌名與歌手 autocomplete、鍵盤與 IME、Apple 來源標示、逐步開放狀態、台灣／韓國與女團／男團的獨立分類。
- 改善：靜態頁面與 imperative DOM 更新改為 React state、refs 和 JSX；過高頁首縮到 78px；外部 Google 字體改為本機中文字體與自託管 Barlow；裝飾性唱片 CSS 改為實際圖片；增加系統明暗模式。
- 首頁標題、描述、URL 與 Apple 相關說明保留。這是私人原型，未取得搜尋排名／流量基準，沒有宣稱 SEO 排名改善。

## 元件與範圍

AppShell 共用頁首、導覽、內容區、頁尾及玩法 dialog。管理後台以 lazy chunk 載入。skill 的行銷首頁規則只用在首頁，答題流程與管理列表不加入捲動特效或行銷式版塊。動畫強度 3，只保留 hover/focus 狀態，尊重 reduced-motion。深色與亮色使用同一套 token，元件不自行換主題。圖示採 Phosphor regular weight；原有品牌符號保留。

## 主視覺

使用內建 image_gen，原圖 `artwork/record-hero.png`；`scripts/prepare-assets.mjs` 僅轉成供網頁傳輸的 WebP，不改構圖。輸出 `public/images/record-hero.webp`。提示詞：

> Use case: product-mockup. Asset type: homepage hero image for Seoul Signal, a Taiwanese and Korean music guessing club. Create a premium photographic still life of a real black vinyl record partly drawn from a plain hot rose pink paper sleeve, lying diagonally on warm off-white paper. Close tactile paper fibers, realistic concentric vinyl grooves, restrained soft directional studio shadows. Square image composition, object centered with generous negative margins so not cut off. Palette off-white #f5f3ee, charcoal, rose #c6275d. No typography, no lettering, no logos, no people, no extra decorations, no user interface. Editorial record-store photography, crisp elegant quiet composition.

## Pre-flight

- 品牌與資訊架構保留；只演進字體、間距、狀態與架構。App Shell 所有畫面皆由 React 渲染，不以 innerHTML 包住舊頁面。
- 單一色系、按鈕 6px／內容面板 10px；無襯線字體；無紫色漸層、跑馬燈、浮動裝飾點或假產品截圖。
- 首頁兩行標題、CTA 在桌機與 390px 手機首屏可見；按鈕不換行，手機無橫向溢出。表單有 label、focus、空白／loading／error 狀態。
- 明暗模式皆實際檢視；autocomplete 滑鼠與鍵盤、IME、答案重設、五題與再玩、API 失敗重試有測試。輸入與圖示保持對比，沒有行銷計分圖或多餘 section 編號。
- 首頁無 em dash、無 testimonial／logo wall／bento／scroll hijack 等不相關內容，因此相關矩陣項目不適用。遊戲分數和排行榜名次是功能資料，不是裝飾。
- 自託管英文字體使用 font-display: swap。中文字使用裝置字體以避免載入整套 CJK 字型。CSS/JS 啟用 gzip，hash 資源長快取，API no-store。
- 本機 Lighthouse 手機模擬：Performance 99、Accessibility 100、Best Practices 100；FCP 1.4s、LCP 2.0s、TBT 0ms、CLS 0。這不是 Zeabur 正式環境測量，也不是實際使用者 INP 統計。
- Node/API/SQLite 測試 20 項、React 互動測試 6 項通過。Zeabur 多階段 Dockerfile 已更新，尚未部署；本機未啟動 Docker daemon，未宣稱完成容器建置測試。

## 2026-10-13 猜歌介面更新

保留紙白、Logo 粉紅 #c6275d 與黑膠品牌語言。答題頁左側改為 CSS 原生粉紅唱片盤、黑膠溝槽與唱臂，音訊播放時以 transform 旋轉，暫停／緩衝／結束停止；減少動態偏好下停用旋轉。下方為播放按鈕與唯讀 progress，右側為作答時間、當前可得分數、分段規則與 autocomplete。手機改為上下排列。曲庫只選華語或 K-POP，男女可合併；玩法、後台標籤與結果明細同步更新。原首頁生成素材沿用，未另行生成圖像。

速度計分與曲庫隔離由 21 項 Node/API 測試及 8 項 React 測試驗證，包含秒數邊界、錯答／揭曉、下一題重設、暫停／重播不重設及同輪不得混合曲庫。先前 Lighthouse 數值為上一版基準，本次未重測。

實際瀏覽器驗證：Apple 試聽可播放、暫停唱片停止、首次計時不因暫停而重設、送出正確答案取得對應分段分數。亮／暗模式已檢視，375px 內容寬度與 scrollWidth 相同，無橫向溢出。進度為原生 progress，頁面沒有 range/slider 控制。

## 唱片置中與版面精簡

移除唱片向下 margin，改為 grid 中央定位；中央標籤使用獨立 disc-label，避免舊首頁固定寬高污染。黑膠直徑為底盤的 72%，中央標籤依黑膠比例定位。桌機底盤／黑膠／標籤圓心實測完全一致，手機旋轉時誤差小於 0.001px。桌機遊戲區縮至 900px、左側 360px，手機唱片縮至 180px，送出按鈕可在 844px 高度首屏看到。移除重複提示與揭曉文案，鍵盤輔助說明保留給螢幕閱讀器，計分規則預設收合。React 8 項互動測試與 production build 通過。

## Docker 前後端分離

原單一 Dockerfile 改為 Dockerfile.frontend 與 Dockerfile.backend；Compose 只公開 Nginx，Node API 透過內網存取，SQLite 保存於 named volume。本次已啟動 Docker Engine，兩個映像建置成功、健康檢查通過。實測靜態路由、404、CSP、API 代理、Origin／CSRF／登入登出，以及重建 backend 後 SQLite 狀態持續存在與 Nginx DNS 重新解析；測試用歌曲狀態已復原。22 項 Node 測試通過（新增 API-only 正式 cookie／origin 測試）。未部署至 Zeabur。
