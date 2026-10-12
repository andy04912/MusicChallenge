# Zeabur 部署紀錄

狀態：已建立專案與服務，尚未上傳原始碼、掛載 Volume 或完成部署。

- 指定伺服器：Tencent Jakarta 2C 2GB
- Server ID：6a50c5bfe33921bfb5d0f989
- Project：seoul-signal / 6acd1f3efaa6e043a4b709ca
- Environment：production / 6acd1f3e5a13ed952d8b20e4
- Backend：6acd1f544873e494859de171
- Frontend：6acd1f574873e494859de174
- 已申請前端網域：https://seoul-signal.zeabur.app （尚未上線）
- 前端 API_UPSTREAM：http://service-6acd1f544873e494859de171:8080
- 後端 APP_ORIGIN：https://seoul-signal.zeabur.app
- 前後端均設定 web port 8080；後端沒有公開網域。
- 正式管理員密碼保存於本機 .env.production（Git 忽略，禁止打包上傳）。

待完成：以登入的 Zeabur 控制台上傳本機程式、後端掛載 /data 持久 Volume（node UID/GID 1000:1000 可寫），確認兩個 Dockerfile 分別建置，驗證 HTTPS、API、後台與重啟資料持久性。初始歌曲維持草稿，需管理員逐步開放。

沒有修改「印尼騰訊雲」伺服器或其中的專案。
