# MusicChallenge GHCR 自動部署

只使用 `main` 對應正式環境，不建立 develop。網站維持
https://music-challenge.damove.app，後端繼續只在容器內網提供服務。

`.github/workflows/ci-cd.yml` 在 PR 執行 Node 24 的 `npm ci`、`npm run check`、
`npm test`、`npm run build`，以及 Python 部署工具回歸測試。伺服器測試使用
臨時 SQLite 與臨時埠號，不碰正式 `/data`。PR 不發布映像、不部署。

推送到 `main` 且測試通過後，GitHub-hosted runner 依兩份 Dockerfile 建置並
推送 `ghcr.io/andy04912/musicchallenge-backend` 和
`ghcr.io/andy04912/musicchallenge-frontend`。MusicChallenge 儲存庫目前為公開，
GHCR 繼承儲存庫的公開權限；映像可匿名拉取。映像只包含原始碼與建置成品，
不包含正式環境變數、SQLite 或備份資料。Tag 使用 `production-<commit SHA>`，
實際部署使用 build job 輸出的固定 SHA256 digest。

## VPS 部署

GitHub 使用 `MUSICCHALLENGE_VPS_SSH_KEY` Secret，搭配 Variables
`MUSICCHALLENGE_VPS_HOST`、`MUSICCHALLENGE_VPS_USER`、
`MUSICCHALLENGE_VPS_KNOWN_HOSTS`。專用 SSH 公鑰設為 `restrict`，forced command
固定 `/usr/local/bin/musicchallenge-deploy --project musicchallenge`。

工具原始碼為 `ops/coolify-deploy.py`，由管理者檢查安裝；設定檔為 root 擁有的
`/etc/musicchallenge-deploy.json`。GitHub 部署憑證不能切換專案或環境。

部署 job 的短效 `GITHUB_TOKEN` 只有 `packages: read`，經 SSH stdin 傳到 VPS。
工具暫時設定 root Docker registry 登入，完成或失敗後恢復原設定；不保存長效 PAT。
Coolify 仍負責網域、代理、環境變數、健康檢查與現有持久化 volume。

部署依序執行：

1. 共用 VPS 部署鎖，確認 `main` 最新 commit、測試與映像發布均通過。
2. 拉取兩個 image，驗證 OCI repository、commit 與 environment 標籤。
3. 使用 SQLite backup API 建立一致快照，驗證完整性、雜湊與資料表筆數。
4. 將既有兩個 Coolify 資源改為 Docker Image，依 digest 部署後端。
5. 檢查公開 `/api/health`，部署前端，再檢查網站與 `/api/health` HTTPS。
6. 儲存含 commit、digest、備份與部署編號的收據，撤銷臨時登入。

公開 HTTPS 檢查使用 `MusicChallenge-Deployment-Healthcheck/1.0` User-Agent，
避免 Cloudflare 對預設 Python 用戶端回覆 403；仍驗證 TLS 憑證、HTTP 200
與 API 的 `ok: true`，不略過健康檢查，也不調整 Cloudflare 防護。

VPS 不再安裝 npm 依賴或編譯 Vite。執行中單一後端、網路、資源限制、管理員
設定、來源 HTTPS 憑證及 SQLite volume 均沿用。不得將正式資料放在原始碼目錄。

## 備份與回復

`ops/sqlite-backup.py` 安裝為 `/usr/local/sbin/musicchallenge-backup`。
原每日 timer 不變，`daily-*` 保留最近 14 份；部署前的 `predeploy-*` 另保留最近
14 份，互不擠掉。永久來源快照與歷史備份封存不受保留策略影響。
備份目錄仍為 `/data/coolify/backups/musicchallenge/`，每份附完整性與資料筆數。

收據在 `/home/ubuntu/.codex/deployments/musicchallenge/last-cd-deployment.json`，
切換前映像設定在同目錄 `previous-image-config.json`。
程式回復用 revert commit 重新走 CI/CD；這不會回退 SQLite 資料。
資料還原必須停後端、另存目前資料、驗證所選備份，再還原至相同 volume。

日常發布與重試使用 GitHub workflow，保留必要測試、部署前備份及 HTTPS 檢查。
Coolify UI 可以拉取目前的公開映像，但單獨 Redeploy／Rollback 不會經過 VPS
部署工具的資料庫備份與公開 HTTPS 檢查。
每日與部署前備份仍保存在同台 VPS，異地備份需另外安排。
