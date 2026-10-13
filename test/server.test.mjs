import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
test('admin authorization, release states, import, and restart persistence', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'seoul-signal-test-'));
  const mock = join(dir, 'apple-mock.mjs');
  // Mock only Apple, outside application code. No production bypass is introduced.
  await writeFile(mock, `const real=globalThis.fetch; globalThis.fetch=async (url,options)=>String(url).startsWith('https://itunes.apple.com/')?new Response(JSON.stringify({results:[{kind:'song',trackId:999999,trackName:'Import test',artistName:'Test artist',collectionName:'Test album',previewUrl:'https://audio-ssl.itunes.apple.com/test.m4a',trackViewUrl:'https://music.apple.com/tw/album/test/999999',artworkUrl100:'',releaseDate:'2026-01-01'},{kind:'song',trackId:999998,trackName:'Solo test',artistName:'ROSÉ',previewUrl:'https://audio-ssl.itunes.apple.com/test.m4a',trackViewUrl:'https://music.apple.com/tw/song/999998'},{kind:'song',trackId:999997,trackName:'Duet test',artistName:'ROSÉ & Bruno Mars',previewUrl:'https://audio-ssl.itunes.apple.com/test.m4a',trackViewUrl:'https://music.apple.com/tw/song/999997'},{kind:'song',trackId:999996,trackName:'Song (Live)',artistName:'ROSÉ',previewUrl:'https://audio-ssl.itunes.apple.com/test.m4a',trackViewUrl:'https://music.apple.com/tw/song/999996'},{kind:'song',trackId:999995,trackName:'Song (feat. Guest)',artistName:'ROSÉ',previewUrl:'https://audio-ssl.itunes.apple.com/test.m4a',trackViewUrl:'https://music.apple.com/tw/song/999995'}]}),{headers:{'Content-Type':'application/json'}}):real(url,options);`);
  let child, origin, cookie, csrf;
  async function boot(overrides = {}) {
    child = spawn(process.execPath, ['--import', pathToFileURL(mock).href, 'server.mjs'], { cwd: root, env: { ...process.env, PORT:'0', HOST:'127.0.0.1', DATA_DIR:dir, NODE_ENV:'test', APP_ORIGIN:'', SERVE_STATIC:'true', ADMIN_PASSWORD:'local-integration-password-only', ...overrides }, stdio:['ignore','pipe','pipe'] });
    origin = await new Promise((accept, reject) => {
      let out='', err=''; const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);
      child.stderr.on('data',chunk=>err+=chunk);
      child.stdout.on('data', chunk => { out+=chunk; const match=out.match(/Local: (http:\/\/127\.0\.0\.1:\d+)/); if(match){clearTimeout(timeout);accept(match[1]);} });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${err}`)); });
    });
  }
  async function stop() { if(child && child.exitCode === null){const done=once(child,'exit');child.kill();await done;} }
  const request = (path, options={}) => fetch(origin+path,{...options,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...options.headers}});
  async function login() {const r=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:'local-integration-password-only'})});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf;assert.ok(r.headers.get('set-cookie').includes('HttpOnly'));assert.ok(r.headers.get('set-cookie').includes('SameSite=Strict'));assert.match(r.headers.get('set-cookie'),/Max-Age=34560000/);}
  t.after(async()=>{await stop();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
  await boot();
  await t.test('React app shell and generated assets serve on both entry routes, with no source or API fallback',async()=>{
    const home=await request('/');const html=await home.text();
    assert.equal(home.status,200);assert.match(html,/<div id="root"><\/div>/);assert.doesNotMatch(html,/<section id="home"/);
    for(const path of ['/admin','/admin/'])assert.equal(await (await request(path)).text(),html);
    const asset=html.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
    const js=await request(asset);assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.match(js.headers.get('cache-control'),/immutable/);
    for(const path of ['/src/main.jsx','/package.json','/assets/missing.js','/api/missing'])assert.equal((await request(path)).status,404);
    assert.equal((await request('/images/record-hero.webp')).status,200);
  });
  await t.test('drafts are seeded privately, never returned to anonymous visitors', async()=>{
    assert.deepEqual(await (await request('/api/catalog')).json(),[]);
    for(const path of ['/catalog.json','/seeds/catalog.json','/data/songs.sqlite','/.env']) assert.equal((await request(path)).status,404);
    assert.equal((await request('/api/admin/songs')).status,401);
    assert.equal((await request('/api/admin/charts?type=mandopop')).status,401);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:'{"ids":[1],"status":"published"}'})).status,401);
  });
  await t.test('login checks origin and password',async()=>{
    assert.equal((await request('/api/admin/login',{method:'POST',headers:{Origin:'https://other.test'},body:'{}'})).status,403);
    assert.equal((await request('/api/admin/login',{method:'POST',body:'{"password":"wrong"}'})).status,401);
    await login();
    assert.equal((await request('/api/admin/charts?type=invalid')).status,400);
  });
  const songs=await (await request('/api/admin/songs')).json();
  assert.equal(songs.length,35); assert.ok(songs.every(s=>s.status==='draft')); assert.ok(songs.every(s=>s.region==='kr'));
  const ids=songs.slice(0,5).map(s=>s.id);
  await t.test('publishing requires CSRF and accepts only valid states',async()=>{
    assert.equal((await request('/api/admin/songs',{method:'PATCH',headers:{'X-CSRF-Token':''},body:JSON.stringify({ids,status:'published'})})).status,403);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids,status:'anything'})})).status,400);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids:[],status:'published'})})).status,400);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids,status:'published'})})).status,200);
    const live=await (await request('/api/catalog')).json();assert.equal(live.length,5);assert.deepEqual(live.map(s=>s.id).sort(),[...ids].sort());
  });
  await t.test('region updates are validated and returned in the public catalog',async()=>{
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids,region:'invalid'})})).status,400);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids:[ids[2]],region:'tw'})})).status,200);
    const live=await (await request('/api/catalog')).json();assert.equal(live.find(s=>s.id===ids[2]).region,'tw');
    assert.ok(live.filter(s=>s.id!==ids[2]).every(s=>s.region==='kr'));
  });
  await t.test('release year edits validate atomically and are visible in the public catalog',async()=>{
    const update = year => request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids:[ids[2]],year})});
    assert.equal((await update('2004')).status,200);
    for (const year of [2004,null,'04','2004x','1899','2099']) assert.equal((await update(year)).status,400);
    assert.equal((await (await request('/api/catalog')).json()).find(s=>s.id===ids[2]).year,'2004');
    assert.equal((await update('')).status,200);
    assert.equal((await (await request('/api/catalog')).json()).find(s=>s.id===ids[2]).year,'');
    assert.equal((await update('2004')).status,200);
  });
  await t.test('unpublishing removes songs from the public catalog',async()=>{
    await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids:[ids[0]],status:'archived'})});
    await request('/api/admin/songs',{method:'PATCH',body:JSON.stringify({ids:[ids[1]],status:'draft',category:'other'})});
    const live=await (await request('/api/catalog')).json();assert.equal(live.length,3);assert.ok(live.every(s=>![ids[0],ids[1]].includes(s.id)));
  });
  await t.test('imports always create drafts, ignore duplicates, and throttle Apple calls',async()=>{
    const response=await request('/api/admin/import',{method:'POST',body:'{"ids":[999999,999998,999997,999996,999995],"categories":{"999998":"boy"},"region":"tw"}'});
    assert.deepEqual(await response.json(),{imported:3,skipped:2});
    const imported=(await (await request('/api/admin/songs')).json()).find(s=>s.id===999999);assert.equal(imported.status,'draft');assert.equal(imported.categoryReview,1);assert.equal(imported.region,'tw');
    const all=await (await request('/api/admin/songs')).json();
    assert.equal(all.find(s=>s.id===999998).category,'boy');
    assert.equal(all.find(s=>s.id===999998).categorySource,'manual');
    assert.equal(all.find(s=>s.id===999997).category,'other');
    assert.equal(all.find(s=>s.id===999997).categoryReview,0);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:'{"ids":[999999,999998],"status":"published"}'})).status,409);
    assert.equal((await (await request('/api/admin/songs')).json()).find(s=>s.id===999998).status,'draft');
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:'{"ids":[999999],"category":"boy"}'})).status,200);
    assert.equal((await (await request('/api/admin/songs')).json()).find(s=>s.id===999999).categorySource,'manual');
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:'{"ids":[999998],"category":"boy"}'})).status,200);
    assert.equal((await request('/api/admin/songs',{method:'PATCH',body:'{"ids":[999998],"category":"auto"}'})).status,200);
    assert.equal((await (await request('/api/admin/songs')).json()).find(s=>s.id===999998).category,'girl');
    assert.equal((await request('/api/admin/search?q=test')).status,429);
    assert.equal((await (await request('/api/catalog')).json()).length,3);
  });
  await stop(); await boot();
  await t.test('database and login persist across restart with the original cookie and CSRF token',async()=>{
    const session = await request('/api/admin/session');
    assert.equal(session.status,200);
    assert.equal((await session.json()).csrf,csrf);
    assert.match(session.headers.get('set-cookie'),/Max-Age=34560000/);
    assert.ok(session.headers.get('set-cookie').startsWith(cookie+';'));
    const saved = new DatabaseSync(join(dir,'songs.sqlite'));
    const token = cookie.split('=')[1];
    const stored = saved.prepare('SELECT * FROM admin_sessions WHERE tokenHash=?').get(createHash('sha256').update(token).digest('hex'));
    assert.ok(stored);assert.equal(JSON.stringify(stored).includes(token),false);
    // Age alone must not invalidate an otherwise valid persistent session.
    saved.prepare("UPDATE admin_sessions SET createdAt='2000-01-01T00:00:00Z'").run();saved.close();
    assert.equal((await request('/api/admin/session')).status,200);
    const rows=await (await request('/api/admin/songs')).json();assert.equal(rows.length,38);assert.equal(rows.find(s=>s.id===ids[2]).region,'tw');assert.equal(rows.find(s=>s.id===999999).region,'tw');
    assert.equal(rows.find(s=>s.id===ids[0]).status,'archived');assert.equal(rows.find(s=>s.id===ids[1]).category,'other');
    assert.equal(rows.find(s=>s.id===ids[2]).year,'2004');
    assert.equal((await (await request('/api/catalog')).json()).length,3);
    const response=await request('/api/admin/import',{method:'POST',body:'{"ids":[999999],"categories":{"999999":"girl"}}'});
    assert.deepEqual(await response.json(),{imported:0,skipped:1});
    assert.equal((await (await request('/api/admin/songs')).json()).find(s=>s.id===999999).category,'boy');
  });
  await t.test('search, publishing and public catalog cannot reintroduce excluded versions',async()=>{
    const saved = new DatabaseSync(join(dir,'songs.sqlite'));
    const old = saved.prepare('SELECT title,status FROM songs WHERE id=999999').get();
    try {
      saved.prepare("UPDATE songs SET title='Test (Live)',status='published' WHERE id=999999").run();
      assert.equal((await (await request('/api/catalog')).json()).some(s=>s.id===999999),false);
      assert.equal((await request('/api/admin/songs',{method:'PATCH',body:'{"ids":[999999],"status":"published"}'})).status,409);
      assert.equal((await (await request('/api/admin/songs')).json()).find(s=>s.id===999999).excludedReason,'Live 現場版本');
    } finally {saved.prepare('UPDATE songs SET title=?,status=? WHERE id=999999').run(old.title,old.status);saved.close();}
  });
  await t.test('logout revokes only that session and cannot be replayed',async()=>{
    const otherLogin=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:'local-integration-password-only'})});
    assert.equal(otherLogin.status,200);
    const otherCookie=otherLogin.headers.get('set-cookie').split(';')[0], otherCsrf=(await otherLogin.json()).csrf;
    const loggedOut = await request('/api/admin/logout',{method:'POST',body:'{}'});
    assert.equal(loggedOut.status,200);assert.match(loggedOut.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await request('/api/admin/songs')).status,401);
    assert.equal((await request('/api/admin/session',{headers:{Cookie:otherCookie}})).status,200);
    assert.equal((await request('/api/admin/logout',{method:'POST',headers:{Cookie:otherCookie,'X-CSRF-Token':otherCsrf},body:'{}'})).status,200);
  });
  await stop();await boot();cookie='';csrf='';await login();
  const searchResult=await request('/api/admin/search?q=test');assert.equal(searchResult.status,200);
  assert.deepEqual((await searchResult.json()).map(s=>s.id),[999999,999998,999997]);
  await request('/api/admin/logout',{method:'POST',body:'{}'});
  await stop();
  await boot({SERVE_STATIC:'false', NODE_ENV:'production', APP_ORIGIN:'https://music.example.test'});
  await t.test('API-only deployment exposes no frontend and retains production cookie and origin protections', async()=>{
    assert.equal((await request('/api/admin/session')).status,401); // revoked cookie stays revoked after restart
    for(const path of ['/','/admin','/index.html','/images/record-hero.webp']) assert.equal((await request(path)).status,404);
    assert.deepEqual(await (await request('/api/health')).json(),{ok:true});
    assert.equal((await request('/api/catalog')).status,200);
    const options={method:'POST',body:JSON.stringify({password:'local-integration-password-only'})};
    assert.equal((await request('/api/admin/login',options)).status,403);
    const response=await request('/api/admin/login',{...options,headers:{Origin:'https://music.example.test'}});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'),/; Secure/);
    assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    assert.equal(response.headers.get('cache-control'),'no-store');
    cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;
  });
  await stop();await boot({ADMIN_PASSWORD:'replacement-admin-password'});
  await t.test('changing the admin password revokes old persistent credentials',async()=>{
    assert.equal((await request('/api/admin/session')).status,401);
    const response=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:'replacement-admin-password'})});
    assert.equal(response.status,200);
  });
  await stop();await boot();
  assert.equal((await request('/api/admin/session')).status,401); // restoring an old password cannot revive old cookies
});
