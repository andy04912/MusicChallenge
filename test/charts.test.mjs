import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharts } from '../charts.mjs';

const entry = id => ({id:String(id),name:`Song ${id}`,artistName:'Artist',url:`https://music.apple.com/tw/song/${id}`,releaseDate:'2026-10-01'});
const response = results => new Response(JSON.stringify({feed:{updated:'2026-10-12T16:00:00Z',results}}));
test('charts retain original ranks and unavailable songs; lookup order does not affect ranking',async()=>{
  const chart=createCharts({fetchFeed:async()=>response([entry(10),entry(20),entry(30)]),lookup:async ids=>{
    assert.deepEqual(ids,[10,20,30]);return [{id:30,title:'Third',preview:'https://audio-ssl.itunes.apple.com/3.m4a'},{id:10,title:'First',preview:'https://audio-ssl.itunes.apple.com/1.m4a'}];
  }});
  const data=await chart('kr');
  assert.deepEqual(data.songs.map(s=>s.id),[10,20,30]);
  assert.deepEqual(data.songs.map(s=>s.rank),[1,2,3]);
  assert.equal(data.songs[1].unavailable,true);assert.equal(data.songs[1].preview,null);
  assert.equal(data.songs[0].unavailable,false);assert.equal(data.region,'kr');
});
test('region allowlist rejects arbitrary URLs before network calls',async()=>{
  let calls=0;
  const chart=createCharts({fetchFeed:async()=>{calls++;return response([]);},lookup:async()=>[]});
  for(const region of ['us','../tw',null,'https://example.com']) await assert.rejects(chart(region),{status:400});
  assert.equal(calls,0);
});
test('caches each region, coalesces simultaneous requests, and refreshes expired data',async()=>{
  let calls=0, time=1000;
  const chart=createCharts({now:()=>time,ttl:100,fetchFeed:async url=>{calls++;assert.match(url,/\/(tw|kr)\/music\/most-played\/50\/songs.json$/);return response([entry(10)]);},lookup:async()=>[]});
  await Promise.all([chart('tw'),chart('tw')]);assert.equal(calls,1);
  await chart('tw');assert.equal(calls,1);
  await chart('kr');assert.equal(calls,2);
  time=1200;await chart('tw');assert.equal(calls,3);
});
test('failed or empty charts are not cached and allow a clean retry',async()=>{
  let calls=0;
  const chart=createCharts({fetchFeed:async()=>response(++calls===1?[]:[entry(10)]),lookup:async()=>[]});
  await assert.rejects(chart('tw'),{status:502});
  assert.equal((await chart('tw')).songs.length,1);assert.equal(calls,2);
});
test('lookup throttling remains actionable instead of being presented as an empty chart',async()=>{
  const chart=createCharts({fetchFeed:async()=>response([entry(10)]),lookup:async()=>{throw Object.assign(new Error('Wait'),{status:429});}});
  await assert.rejects(chart('tw'),{status:429});
});
