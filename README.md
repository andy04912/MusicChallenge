# Seoul Signal

繁體中文 K-pop 猜歌原型。原生 HTML / CSS / JavaScript，無需套件安裝。

## 本機啟動

```sh
npm run dev
```

開啟 http://127.0.0.1:4173 。`npm run check` 檢查 JavaScript 語法。

## 音源

`npm run catalog` 從 Apple iTunes Search API 更新台灣商店的曲目中繼資料。只保存歌名、歌手、專輯、年份、封面網址、試聽網址及商店連結；不下載、快取或重新代管音訊與封面。

播放器由使用者點擊啟動，直接串流 Apple 提供的片段。試聽長度與起點由 Apple 決定，並非歌曲完整音源。供應可能隨地區或時間變動，失效時可以重試、跳題或重新更新題庫。

每輪隨機五題，四選一，答對 100 分，答案揭曉後顯示歌曲資料及 Apple Music 連結。成績只存在本次頁面記憶體，不收集帳號或分析資料。

## 原型用途

本專案不代表已取得 Apple 對猜歌用途的許可。宣傳展示、來源標示及商店連結並不自動排除 Apple 條款對獨立娛樂用途的限制；對外正式上線前仍需確認適用授權。

- https://performance-partners.apple.com/search-api
- https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html
