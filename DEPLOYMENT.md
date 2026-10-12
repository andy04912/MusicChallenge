# Music Challenge — Zeabur 部署紀錄

2026-10-13：前後端已上線，HTTPS、後台登入及重啟資料持久性已驗證。

- GitHub：https://github.com/andy04912/MusicChallenge ，分支 `main`
- 應用程式部署提交：`69011c9`
- 指定伺服器：Tencent Jakarta 2C 2GB
- Server ID：6a50c5bfe33921bfb5d0f989
- Project：Music-Challenge / 6acd1f3efaa6e043a4b709ca（Zeabur 名稱欄位不接受空格）
- Environment：production / 6acd1f3e5a13ed952d8b20e4
- Backend：6acd1f544873e494859de171，Dockerfile.backend
- Frontend：6acd1f574873e494859de174，Dockerfile.frontend
- 兩個服務使用同一 GitHub repository 根目錄，各自建置 Docker image。
- 前台：https://seoul-signal.zeabur.app
- 後台：https://seoul-signal.zeabur.app/admin
- 前端 API_UPSTREAM：http://service-6acd1f544873e494859de171.environment-6acd1f3e5a13ed952d8b20e4.zeabur.internal:8080
- 後端 APP_ORIGIN：https://seoul-signal.zeabur.app
- 前後端均使用 web port 8080；後端沒有公開網域。
- Backend Volume：songs-data，掛載 `/data`，保存 songs.sqlite 與 WAL 檔案。
- 正式管理員密碼保存於本機 `.env.production` 的 ADMIN_PASSWORD（Git 忽略，不上傳）。

## 上線驗證

- `/`、`/admin`、`/healthz` 及 `/api/health` 回應正常。
- HTTPS 後台登入、Secure Cookie、讀取題庫及 CSRF 登出成功；登出後再次讀取回應 401。
- 初始 35 首歌曲全為草稿，公開曲庫為空；由管理員逐步開放。玩家選取的分類至少需有 5 首開放歌曲。
- 在 `/data` 建立臨時驗證標記後重新啟動 backend，確認標記與 35 首草稿均保留，再移除驗證標記。
- 前端透過完整內網 DNS 名稱代理 API，確認後端重啟後可恢復連線。

沒有修改「印尼騰訊雲」伺服器或其中的專案。
