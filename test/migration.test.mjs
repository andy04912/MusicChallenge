import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

test('upgrades an existing database without changing release states or guessing import regions', async t => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'seoul-migration-'));
  const seed = JSON.parse(await readFile(join(root,'seeds/catalog.json'),'utf8'))[0];
  const db = new DatabaseSync(join(dir,'songs.sqlite'));
  db.exec(`CREATE TABLE songs (id INTEGER PRIMARY KEY,title TEXT,artist TEXT,album TEXT,artwork TEXT,preview TEXT,url TEXT,year TEXT,category TEXT,status TEXT,updatedAt TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES ('seeded','1');`);
  const insert = db.prepare('INSERT INTO songs VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const values = [seed.title,seed.artist,seed.album,seed.artwork,seed.preview,seed.url,seed.year,seed.category];
  insert.run(seed.id,...values,'published','original-time');
  insert.run(999998,...values,'draft','original-time');
  db.close();
  let child;
  async function stop() { if(child && child.exitCode===null && !child.signalCode){const done=once(child,'exit');child.kill();await done;} child = null; }
  t.after(async()=>{await stop();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});});
  async function boot() {
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir,NODE_ENV:'test',APP_ORIGIN:'',ADMIN_PASSWORD:'local-migration-password'},stdio:['ignore','pipe','pipe']});
    await new Promise((done,reject)=>{
      let output='',errors=''; const timer=setTimeout(()=>reject(new Error('Startup timed out')),10000);
      child.stderr.on('data',part=>errors+=part);
      child.stdout.on('data',part=>{output+=part;if(output.includes('Local:')){clearTimeout(timer);done();}});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error(errors));});
    });
  }
  await boot(); await stop();
  const migrated=new DatabaseSync(join(dir,'songs.sqlite'));
  const rows=migrated.prepare('SELECT * FROM songs ORDER BY id').all();
  assert.equal(rows.length,2);
  assert.equal(rows.find(s=>s.id===seed.id).region,'kr');
  assert.equal(rows.find(s=>s.id===seed.id).status,'published');
  assert.equal(rows.find(s=>s.id===999998).region,'other');
  assert.ok(rows.every(s=>s.updatedAt==='original-time'));
  migrated.prepare("UPDATE songs SET region='tw' WHERE id=?").run(seed.id);
  migrated.close();
  await boot(); await stop();
  const again=new DatabaseSync(join(dir,'songs.sqlite'));
  assert.equal(again.prepare('SELECT region FROM songs WHERE id=?').get(seed.id).region,'tw');
  again.close();
});
