import { createServer } from 'node:http';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { createCharts } from './charts.mjs';
import { classifySong, manualCategory, excludedVersionReason } from './classify.mjs';
import { gzipSync } from 'node:zlib';
import { createGameplayHandler } from './game-service.mjs';

const base = fileURLToPath(new URL('.', import.meta.url));
const password = process.env.ADMIN_PASSWORD || '';
if (password.length < 16 || password === 'replace-with-a-long-unique-password') {
  throw new Error('Set ADMIN_PASSWORD to a unique password of at least 16 characters in .env or service environment variables.');
}
const production = process.env.NODE_ENV === 'production';
const configuredOrigin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
const dataDir = resolve(process.env.DATA_DIR || resolve(base, 'data'));
await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, 'songs.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS songs (
   id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL,
   artwork TEXT NOT NULL, preview TEXT NOT NULL, url TEXT NOT NULL, year TEXT NOT NULL,
   category TEXT NOT NULL CHECK(category IN ('girl','boy','other')),
   status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
   updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 );
 CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions (
   tokenHash TEXT PRIMARY KEY, csrf TEXT NOT NULL,
   createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 );`);
const seed = JSON.parse(await readFile(resolve(base, 'seeds/catalog.json'), 'utf8'));
// Existing imports have no reliable country metadata. Only known K-pop seeds
// can be classified automatically; chart storefront is not song origin.
if (!db.prepare('PRAGMA table_info(songs)').all().some(column => column.name === 'region')) {
  db.exec('BEGIN');
  try {
    db.exec("ALTER TABLE songs ADD COLUMN region TEXT NOT NULL DEFAULT 'other' CHECK(region IN ('tw','kr','other'))");
    const classify = db.prepare("UPDATE songs SET region='kr' WHERE id=?");
    for (const song of seed) classify.run(song.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
// Keep existing operator classifications intact during this additive migration.
for (const [name, definition] of Object.entries({ categoryReview: 'INTEGER NOT NULL DEFAULT 0', categorySource: "TEXT NOT NULL DEFAULT 'legacy'", categoryReason: "TEXT NOT NULL DEFAULT '既有分類，可逐曲重新判斷'" })) {
  if (!db.prepare('PRAGMA table_info(songs)').all().some(column => column.name === name)) db.exec(`ALTER TABLE songs ADD COLUMN ${name} ${definition}`);
}
const columns = 'id,title,artist,album,artwork,preview,url,year,category,region';
const importColumns = `${columns},categoryReview,categorySource,categoryReason`;
const insert = db.prepare(`INSERT OR IGNORE INTO songs (${importColumns}) VALUES (${importColumns.split(',').map(() => '?').join(',')})`);
const addSong = song => insert.run(...importColumns.split(',').map(k => song[k]));
if (!db.prepare("SELECT value FROM settings WHERE key='seeded'").get()) {
  db.exec('BEGIN');
  try {
    for (const song of seed) addSong({ ...song, ...classifySong(song), region: 'kr' });
    db.prepare("INSERT INTO settings VALUES ('seeded','1')").run();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
// Persist sessions with the catalog volume. Only token digests are stored.
// Keep password-change revocation without expiring sessions on process restart.
let authSalt = db.prepare("SELECT value FROM settings WHERE key='authSalt'").get()?.value;
if (!authSalt) {
  authSalt = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key,value) VALUES ('authSalt',?)").run(authSalt);
}
const salt = Buffer.from(authSalt, 'hex'), passwordHash = scryptSync(password, salt, 64);
const verifier = passwordHash.toString('hex');
const previousVerifier = db.prepare("SELECT value FROM settings WHERE key='authVerifier'").get()?.value;
if (previousVerifier !== verifier) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM admin_sessions').run();
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('authVerifier',?)").run(verifier);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
const attempts = new Map();
const hash = text => createHash('sha256').update(text).digest('hex');
const readSession = db.prepare('SELECT tokenHash AS key,csrf FROM admin_sessions WHERE tokenHash=?');
const saveSession = db.prepare('INSERT INTO admin_sessions (tokenHash,csrf) VALUES (?,?)');
const removeSession = db.prepare('DELETE FROM admin_sessions WHERE tokenHash=?');
const cookieLifetimeSeconds = 400 * 24 * 60 * 60;
function sessionCookie(res, token, maxAge = cookieLifetimeSeconds) {
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${production ? '; Secure' : ''}`);
}
const fail = (status, message) => Object.assign(new Error(message), { status });
const cleanup = setInterval(() => {
  for (const [key, attempt] of attempts) if (attempt.until < Date.now()) attempts.delete(key);
}, 60000).unref();
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, '請使用 JSON 格式。');
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 65536) throw fail(413, '資料過大。'); }
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw fail(400, '資料格式不正確。'); }
}
function sameOrigin(req) {
  const origin = configuredOrigin || `${production ? 'https' : 'http'}://${req.headers.host}`;
  if (req.headers.origin !== origin) throw fail(403, '請從本站後台操作。');
}
function sessionFor(req) {
  const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('admin_session='))?.slice(14);
  const session = token && /^[A-Za-z0-9_-]{43}$/.test(token) && readSession.get(hash(token));
  if (!session) throw fail(401, '請先登入後台。');
  return { ...session, token };
}
function idsFrom(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw fail(400, '請選擇 1 至 200 首歌曲。');
  return [...new Set(ids)];
}
let appleNextRequest = 0;
async function apple(path, params) {
  if (Date.now() < appleNextRequest) throw fail(429, 'Apple 查詢請間隔 3 秒後再試。');
  appleNextRequest = Date.now() + 3100;
  try {
    const url = new URL(path, 'https://itunes.apple.com');
    url.search = new URLSearchParams({ ...params, country: 'TW', entity: 'song' });
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Apple ${response.status}`);
    return (await response.json()).results;
  } catch { throw fail(502, 'Apple 曲庫暫時無法連線，請稍後重試。'); }
}
function fromApple(song, category = 'other', region = 'other') {
  if (song.kind !== 'song' || !song.previewUrl?.startsWith('https://') || !song.trackId) return null;
  const row = { id: song.trackId, title: song.trackName, artist: song.artistName, album: song.collectionName || '', artwork: song.artworkUrl100 || '', preview: song.previewUrl, url: song.trackViewUrl, year: (song.releaseDate || '').slice(0, 4), category, region };
  return { ...row, ...classifySong(row) };
}
const getChart = createCharts({ lookup: async ids => (await apple('/lookup', { id: ids.join(','), limit: '200' })).map(song => fromApple(song)).filter(Boolean) });
const gameplay = createGameplayHandler({ db, body, json, sameOrigin, production, getPublishedSongs: () => db.prepare(`SELECT ${columns} FROM songs WHERE status='published' AND categoryReview=0 ORDER BY artist,title`).all().filter(song => !excludedVersionReason(song)) });
const serveStatic = process.env.SERVE_STATIC !== 'false';
const staticFiles = new Map(serveStatic ? [
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/admin', 'index.html'], ['/admin/', 'index.html'], ['/leaderboard', 'index.html'], ['/duel', 'index.html'], ['/party', 'index.html']
] : []);
const distDir = resolve(base, 'dist');
// Serve only generated assets, never project source, secrets or SQLite files.
for (const folder of serveStatic ? ['assets', 'images', 'icons'] : []) {
  try {
    for (const entry of await readdir(resolve(distDir, folder), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = relative(distDir, resolve(entry.parentPath, entry.name)).split(sep).join('/');
      staticFiles.set(`/${name}`, name);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (serveStatic) {
  const publicEntries = await readdir(distDir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const filename of ['manifest.webmanifest', 'sw.js', 'offline.html', 'offline.css']) if (publicEntries.includes(filename)) staticFiles.set(`/${filename}`, filename);
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.mzstatic.com; media-src https://*.mzstatic.com https://*.itunes.apple.com; connect-src 'self' https://*.mzstatic.com https://*.itunes.apple.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const url = new URL(req.url, 'http://localhost'), path = url.pathname, method = req.method;
    if (method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
    if (await gameplay.handle(req, res, url)) return;
    if (method === 'GET' && path === '/api/catalog') return json(res, 200, db.prepare(`SELECT ${columns} FROM songs WHERE status='published' AND categoryReview=0 ORDER BY artist,title`).all().filter(song => !excludedVersionReason(song)));
    if (path === '/api/admin/login' && method === 'POST') {
      sameOrigin(req);
      // Do not trust spoofable forwarding headers. A reverse proxy shares this budget.
      const key = req.socket.remoteAddress, now = Date.now();
      let attempt = attempts.get(key);
      if (!attempt || attempt.until < now) attempt = { count: 0, until: now + 15 * 60000 };
      if (attempt.count >= 10) throw fail(429, '登入嘗試過多，請於 15 分鐘後重試。');
      const input = await body(req);
      attempt.count++; attempts.set(key, attempt);
      if (typeof input.password !== 'string' || input.password.length > 512 || !timingSafeEqual(scryptSync(input.password, salt, 64), passwordHash)) throw fail(401, '密碼不正確。');
      attempts.delete(key);
      const token = randomBytes(32).toString('base64url'), csrf = randomBytes(24).toString('base64url');
      saveSession.run(hash(token), csrf);
      sessionCookie(res, token);
      return json(res, 200, { csrf });
    }
    if (path.startsWith('/api/admin/')) {
      const session = sessionFor(req);
      if (!['GET', 'HEAD'].includes(method)) {
        sameOrigin(req);
        if (req.headers['x-csrf-token'] !== session.csrf) throw fail(403, '操作驗證過期，請重新登入。');
      }
      // Refresh the persistent browser cookie on authenticated activity.
      sessionCookie(res, session.token);
      if (path === '/api/admin/session' && method === 'GET') return json(res, 200, { csrf: session.csrf });
      if (path === '/api/admin/logout' && method === 'POST') {
        removeSession.run(session.key);
        sessionCookie(res, '', 0);
        return json(res, 200, { ok: true });
      }
      if (path === '/api/admin/songs' && method === 'GET') return json(res, 200, db.prepare('SELECT * FROM songs ORDER BY updatedAt DESC,id DESC').all().map(song => ({ ...song, excludedReason: excludedVersionReason(song) })));
      if (path === '/api/admin/charts' && method === 'GET') {
        const chart = await getChart(url.searchParams.get('type'));
        const existing = new Set(db.prepare('SELECT id FROM songs').all().map(s => s.id));
        return json(res, 200, { ...chart, songs: chart.songs.map(song => ({ ...song, imported: existing.has(song.id) })) });
      }
      if (path === '/api/admin/search' && method === 'GET') {
        const q = url.searchParams.get('q')?.trim();
        if (!q || q.length > 100) throw fail(400, '請輸入 1 至 100 字的歌名或歌手。');
        const songs = (await apple('/search', { term: q, limit: '100' })).map(s => fromApple(s)).filter(s => s && !excludedVersionReason(s));
        const existing = new Set(db.prepare('SELECT id FROM songs').all().map(s => s.id));
        return json(res, 200, songs.map(s => ({ ...s, imported: existing.has(s.id) })));
      }
      if (path === '/api/admin/import' && method === 'POST') {
        const input = await body(req), ids = idsFrom(input.ids);
        const overrides = input.categories ?? {};
        if (input.category !== undefined) throw fail(400, '請逐首設定分類。');
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.entries(overrides).some(([id, value]) => !ids.includes(Number(id)) || !['girl','boy','other','pending'].includes(value))) throw fail(400, '歌曲分類不正確。');
        const region = input.region ?? 'other';
        if (!['tw','kr','other'].includes(region)) throw fail(400, '歌曲地區不正確。');
        const songs = (await apple('/lookup', { id: ids.join(',') })).filter(s => ids.includes(s.trackId)).map(s => fromApple(s, 'other', region)).filter(s => s && !excludedVersionReason(s)).map(song => Object.hasOwn(overrides, song.id) ? { ...song, ...manualCategory(overrides[song.id]) } : song);
        let imported = 0;
        db.exec('BEGIN');
        try { for (const song of songs) imported += Number(addSong(song).changes); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { imported, skipped: ids.length - imported });
      }
      if (path === '/api/admin/songs' && method === 'PATCH') {
        const input = await body(req), ids = idsFrom(input.ids), updates = [];
        if (input.status !== undefined) {
          if (!['draft','published','archived'].includes(input.status)) throw fail(400, '歌曲狀態不正確。');
          updates.push(['status', input.status]);
        }
        if (input.category !== undefined && !['girl','boy','other','pending','auto'].includes(input.category)) throw fail(400, '歌曲分類不正確。');
        if (input.region !== undefined) {
          if (!['tw','kr','other'].includes(input.region)) throw fail(400, '歌曲地區不正確。');
          updates.push(['region', input.region]);
        }
        if (input.year !== undefined) {
          if (typeof input.year !== 'string' || (input.year !== '' && (!/^(19|20)\d{2}$/.test(input.year) || Number(input.year) > new Date().getFullYear() + 1))) throw fail(400, '請輸入有效的四位數發行年份，或留白為未知。');
          updates.push(['year', input.year]);
        }
        if (!updates.length && input.category === undefined) throw fail(400, '請指定狀態、分類或年份。');
        const rows = db.prepare(`SELECT * FROM songs WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
        const changes = rows.map(song => {
          const values = Object.fromEntries(updates);
          if (input.category !== undefined) Object.assign(values, input.category === 'auto' ? classifySong(song) : manualCategory(input.category));
          if ((values.status ?? song.status) === 'published' && excludedVersionReason(song)) throw fail(409, 'Live 與 Feat 版本已排除，不能開放。');
          if ((values.status ?? song.status) === 'published' && (values.categoryReview ?? song.categoryReview)) throw fail(409, '待確認歌曲不能開放；已開放歌曲請先移回草稿，再改成待確認。');
          return [song.id, values];
        });
        let updated = 0;
        db.exec('BEGIN');
        try {
          for (const [id, values] of changes) updated += Number(db.prepare(`UPDATE songs SET ${Object.keys(values).map(key => `${key}=?`).join(',')}, updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(...Object.values(values), id).changes);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { updated });
      }
      throw fail(404, '找不到這個功能。');
    }
    if ((method === 'GET' || method === 'HEAD') && (staticFiles.has(path) || (serveStatic && /^\/(?:duel\/[A-Za-z0-9_-]{6,32}|party\/P[A-Za-z0-9_-]{15}|result\/[A-Za-z0-9_-]{24})\/?$/.test(path)))) {
      const filename = staticFiles.get(path) || 'index.html';
      let content = await readFile(resolve(base, 'dist', filename));
      const compressible = ['.html','.js','.css','.svg'].includes(extname(filename));
      if (compressible) {
        res.setHeader('Vary', 'Accept-Encoding');
        const acceptsGzip = (req.headers['accept-encoding'] || '').split(',').some(value => value.trim().split(';')[0] === 'gzip' && !/q=0(?:\.0*)?\s*$/.test(value));
        if (acceptsGzip) { content = gzipSync(content); res.setHeader('Content-Encoding', 'gzip'); }
      }
      res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      return res.end(method === 'HEAD' ? undefined : content);
    }
    throw fail(404, '找不到頁面。');
  } catch (error) {
    if (!error.status) console.error('Request failed:', error.message);
    json(res, error.status || 500, { error: error.status ? error.message : '服務暫時發生問題，請稍後重試。' });
  }
});
server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { clearInterval(cleanup); gameplay.close(); server.close(() => { db.close(); process.exit(0); }); });
