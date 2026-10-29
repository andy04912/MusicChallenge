# MusicChallenge GHCR 自動部署

只使用 `main` 對應正式環境，不建立 develop。網站為
https://music-challenge.damove.app，後端只在容器內網提供服務。

`.github/workflows/ci-cd.yml` 在 PR 執行 Node 24 的 `npm ci`、`npm run check`、
`npm test`、`npm run build`，以及 Python 部署工具回歸測試。伺服器測試使用
臨時 SQLite 與臨時埠號，不碰正式 `/data`。PR 不發布映像、不部署。

推送到 `main` 且測試通過後，GitHub-hosted runner 依兩份 Dockerfile 建置並
推送 `ghcr.io/andy04912/musicchallenge-backend` 和
`ghcr.io/andy04912/musicchallenge-frontend`。MusicChallenge 儲存庫為公開，
GHCR 繼承儲存庫的公開權限；映像可匿名拉取。映像只包含原始碼與建置成品，
不包含正式環境變數、SQLite 或備份資料。Tag 使用 `production-<commit SHA>`，
實際部署使用 build job 輸出的固定 SHA256 digest。

## VPS 部署

服務在 VPS 的 Coolify 中是一個 Docker Compose 服務（參考副本在
`deploy/coolify/compose.yaml`），包含 `backend` 與 `frontend` 兩個容器與
named volume `songs-data`。流量路徑為：訪客 → Cloudflare（橘雲）→ Cloudflare
Tunnel → Coolify 的 Traefik（localhost:80）→ 前端；前端 nginx 再轉送 `/api` 到後端。
VPS 的 80／443 不對外開放。

GitHub 使用 `MUSICCHALLENGE_VPS_SSH_KEY` Secret，搭配 Variables
`MUSICCHALLENGE_VPS_HOST`、`MUSICCHALLENGE_VPS_USER`、
`MUSICCHALLENGE_VPS_KNOWN_HOSTS`。專用 SSH 公鑰設為 `restrict`，forced command
固定 `/usr/local/bin/musicchallenge-deploy --project musicchallenge`。

工具原始碼為 `ops/compose_deploy.py`，由管理者檢查後以 root 安裝；設定檔為 root
擁有的 `/etc/musicchallenge-deploy.json`，只含資源 UUID、容器名稱、必要 CI 檢查與
健康檢查網址。GitHub 部署憑證不能切換專案或環境，工具只接受
`deploy <commit SHA> <backend digest> <frontend digest>`。

部署 job 的短效 `GITHUB_TOKEN` 只有 `packages: read`，經 SSH stdin 傳到 VPS。
工具暫時設定 root Docker registry 登入，完成或失敗後恢復原設定；不保存長效 PAT。

部署依序執行：

1. 共用 VPS 部署鎖，確認 `main` 最新 commit、測試與映像發布均通過。
2. 拉取兩個 image，驗證 OCI repository、commit 與 environment 標籤。
3. 使用 SQLite backup API 建立一致快照，驗證完整性、雜湊與資料表筆數。
4. 保存前一版 Compose，將兩個 image 換成新 digest（前後端各須恰好一處，否則拒絕），
   透過 Coolify API 更新並重啟服務。
5. 等待兩個容器跑在預期 digest 且健康，再檢查公開 `/api/health` 與網站 HTTPS。
6. 更新後任一步失敗，自動還原前一版 Compose 並重啟，再回報失敗。
7. 儲存含 commit、digest 與備份檔名的收據，清除臨時 registry 登入。

公開 HTTPS 檢查使用 `MusicChallenge-Deployment-Healthcheck/1.0` User-Agent，
避免 Cloudflare 對預設 Python 用戶端回覆 403；仍驗證 TLS 憑證、HTTP 200
與 API 的 `ok: true`，不略過健康檢查，也不調整 Cloudflare 防護。

VPS 不安裝 npm 依賴或編譯 Vite。管理員密碼（`ADMIN_PASSWORD`）設定在 Coolify 的
服務環境變數，不進 Git。不得將正式資料放在原始碼目錄。

## 備份與回復

每次部署前的 SQLite 快照（`predeploy-*.sqlite.gz`）保留最近 14 份，位於 VPS 的
`/home/ubuntu/backups/musicchallenge/backups/`。收據為同層上一層的
`last-cd-deployment.json`，前一版 Compose 為 `previous-compose.yaml`。

目前沒有定時備份；兩者都在同一台 VPS，異地備份需另外安排。
程式回復用 revert commit 重新走 CI/CD；這不會回退 SQLite 資料。
資料還原必須停後端、另存目前資料、驗證所選備份，再還原至 `songs-data` volume，
並確保檔案擁有者為容器內的 `node`（uid 1000）。

`/usr/local/bin/musicchallenge-deploy --project musicchallenge --dry-run` 會在本機執行
所有檢查但不備份、不修改 Coolify、不重啟，需以 `SSH_ORIGINAL_COMMAND` 提供部署指令。
日常發布與重試使用 GitHub workflow；Coolify 介面的單獨 Redeploy 不會經過部署工具的
資料庫備份與公開 HTTPS 檢查。
