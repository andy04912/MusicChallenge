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


## 2026-10-13 App-shell 與循環片段

設計判讀：給華語與 K-POP 樂迷的輕量音樂 App，沿用粉紅 #c6275d 與唱片品牌。保留 React + 原生 CSS；DESIGN_VARIANCE 5、MOTION_INTENSITY 4、VISUAL_DENSITY 4。design-taste 技能只套用首頁的字體、色彩與精簡原則，遊戲和後台依產品操作需求安排。

原首頁為照片加選曲表單，下方有說明列與歌手列表；這次依使用者要求移除照片，以共用 Turntable 取代，收斂為單一選曲入口。固定頂部品牌列、桌機側邊導覽／手機底部導覽、獨立內容捲動與來源頁尾。保留原 wordmark、路徑、後台操作與發布狀態。6px 控制項與14px唱盤，明暗模式使用原有語意色彩。

首頁唱片持續旋轉；遊戲唱片跟隨音訊狀態。使用者減少動態時停用旋轉。取消秒錶，改顯示解鎖長度、固定可得分數及各級距。進度條只讀，不提供拖曳；播放控制始終位於唱盤下方。答錯會提示並清空輸入，焦點回到輸入框；最後一段答錯才揭曉。

## Music Challenge 品牌更新

品牌名稱統一為 Music Challenge。標誌採原創 SVG：有同心溝槽的黑膠直接構成搶答鈴底座，粉紅色鈴身、頂部按鈕與兩側聲響線代表搶答挑戰。米白底保持明暗模式的辨識度；不增加標誌本身的動畫，唱片仍沿用旋轉動態。沿用原有設計密度與粉紅色系。

單一標誌來源為 `public/images/music-challenge-mark.svg`，由 BrandMark 共用於前後台品牌列、唱片標籤，亦用作 favicon。品牌列搭配文字 Music Challenge 及 LISTEN. GUESS. WIN.；螢幕閱讀器以連結名稱讀出品牌，避免重複朗讀裝飾圖案。手機保留底部導覽，隱藏重複的「查看前台」連結，避免長品牌名擠壓。

## 手機優先與安全區

後續設計以手機使用性優先。viewport 開啟 viewport-fit=cover，App shell 在固定導覽格線之外一次保留四邊 env(safe-area-inset-*)，避免底部 padding 擠壓導覽按鈕；說明 dialog 亦保留四邊安全區。小螢幕橫向使用手機導覽。首頁唱盤與標題並排、年代固定兩欄，手機互動控制至少 44px 高，輸入欄位維持 16px，允許使用者縮放。

粗略指標裝置播放後不主動聚焦輸入。Android 使用 interactive-widget=resizes-content，Safari 以 VisualViewport 處理鍵盤縮小可視區：輸入中才判斷鍵盤、縮放時不誤判、關閉時還原。鍵盤開啟時暫時隱藏底部導覽與頁尾，候選清單限高、送出按鈕靠近可視底部。後台預覽改在內容捲動區內定位。

驗證：390×844 模擬頂部59px／底部34px；844×390 模擬左右59px／底部21px；另檢查窄版320px。VisualViewport 測試涵蓋 iOS 型可視區縮小、Android 型版面縮小、轉向、失焦、鍵盤關閉及捏合縮放。模擬不等同實體 iOS Safari 驗證。

實作參考：[WebKit safe area](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)、[MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)。


## 手機遊戲流程、無限挑戰與好友房更新

品牌維持 Music Challenge 的粉紅唱盤與黑膠搶答鈴。玩家導覽改為猜歌、好友對戰、排行榜及玩法；歌曲管理只保留獨立 `/admin`。手機設定採分步、候選歌曲與成績採分頁，搭配 safe area、固定可視高度與鍵盤狀態收合，主要遊戲流程不依賴整頁捲動。輸入維持 16px 並依本次需求設定縮放限制；實體瀏覽器仍可能自行覆寫 viewport 限制。

片段秒數與答對分數整合在播放器附近，放大單次播放按鈕，延長片段置於相鄰位置；每次到解鎖上限即停止，由使用者自行重播。答案與送出整合一列，直接揭曉縮為次要操作。玩法改成有唱片視覺的分步說明，得分與回合轉場使用短動畫並尊重 prefers-reduced-motion。

新增經典／無限單人、分頁排行榜與兩人邀請房。房間同題、各自作答，雙方完成才揭曉；分數先呈現本題，再轉為累積；雙方準備才開下一題。判分、去重曲序、累積與房間狀態由 Node／SQLite 保存，SSE 同步畫面。贊助入口為頁尾右側淡粉色 Donate Me! 按鈕，另開指定的 Portaly 贊助頁。

後端驗證包含 44 項測試：訪客身分隔離、SSE 與重新連線、雙方完成／準備屏障、分數不提前洩漏、重複操作、無限歷史裁減後仍保留完整累積。此紀錄描述本次實作，不代表已部署至正式環境；先前 Lighthouse 與手機量測仍屬各自版本的歷史紀錄。

### Mobile play refinements — 2026-10-13

Play mode hides shared app navigation and exposes the rules through a question icon below the solo score. The record scales with available viewport height instead of the earlier 80px cap; compact screens retain all actions without page scrolling. Revealed title/artist sit directly under playback, with Apple Music and next-song actions side by side. Nicknames persist locally while typing. Entering each song preloads and silently decodes its preview; explicit play still controls sound and scoring. Source attribution remains a small single line.

### Duel exit and mobile score placement — 2026-10-14

Removed the duel header home/back link. Explicit leaving uses a native modal with cancel, confirmation, and in-dialog retry feedback. Persisted room closure records the departing member; SSE tells the other player who left and removes playback. Connection interruption remains reconnectable. Mobile solo totals and duel player totals now sit above the record, while the top-right help entry remains available. Verified two-player cancel/confirm/remote-close flow and 320px layout.

### 對戰結算與內容層次 — 2026-10-14

好友對戰採結束／準備雙操作，左側結束、右側準備。主動結束後直接結算，對方先確認具名通知再查看成績。保留已完成作答的得分，結算不再揭露未完成歌曲。手機導覽字級為 13px、字重 600，維持原有安全區與固定高度；玩家內容區使用淡玫瑰灰 #f0e7e9，深色模式使用 #211a20，與導覽及操作面板拉開層次。

### 派對模式 — 2026-10-14

導覽新增「派對」。主控以唱盤播放器搭配 QR Code／即時答對榜，參賽者手機只提供作答與分數；遊玩時收起導覽，保留問號玩法。全曲試聽由主控明確點擊開始，播放按鈕不採分段、不自動循環。每題名次即時更新，答錯可重試，所有人完成或主控揭曉後才換題。

頒獎台以第二、第一、第三名呈現高低，使用銀灰、品牌粉紅與銅色區分；所有參賽者以橫列分頁保持固定視窗，煙火僅短暫播放並尊重減少動態效果設定。分享頁沿用互動頒獎台，PNG 使用同一排名資料。已驗證 320 × 568 分享頁無頁面溢出、桌面三人頒獎、手機答錯重試／即時名次，以及實際 PNG 下載。手機尺寸使用瀏覽器模擬，尚未在實體 iPhone 測試。
