import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharts } from '../charts.mjs';
const entry = (id, genre = '1253') => ({id:String(id),name:`Song ${id}`,artistName:'Artist',url:`https://music.apple.com/tw/song/${id}`,releaseDate:'2026-10-01',genres:[{genreId:genre}]});
const response = results => new Response(JSON.stringify({feed:{updated:'2026-10-12T16:00:00Z',results}}));
test('both categories use Taiwan ranks and genre metadata, not names or artist nationality',async()=>{
  const chart=createCharts({fetchFeed:async url=>{
    assert.equal(url,'https://rss.marketingtools.apple.com/api/v2/tw/music/most-played/100/songs.json');
    return response([entry(10),entry(20,'14'),entry(30,'51'),entry(40,'51'),{...entry(50),genres:[]}]);
  },lookup:async ids=>{
    assert.deepEqual(ids,[10,20,30,40,50]);return [{id:30,title:'English title',region:'other',preview:'https://audio-ssl.itunes.apple.com/3.m4a'},{id:10,title:'First',preview:'https://audio-ssl.itunes.apple.com/1.m4a'}];
  }});
  const data=await chart('kpop');
  assert.deepEqual(data.songs.map(s=>s.id),[30,40]);
  assert.deepEqual(data.songs.map(s=>s.rank),[3,4]);
  assert.equal(data.songs[1].unavailable,true);assert.equal(data.songs[1].preview,null);
  assert.equal(data.songs[0].unavailable,false);assert.equal(data.songs[0].region,'kr');
  assert.equal(data.storefront,'tw');assert.equal(data.type,'kpop');
  assert.deepEqual((await chart('mandopop')).songs.map(s=>[s.id,s.rank,s.region]),[[10,1,'tw']]);
});
test('type allowlist rejects countries, arbitrary URLs and prototype properties before network calls',async()=>{
  let calls=0;
  const chart=createCharts({fetchFeed:async()=>{calls++;return response([]);},lookup:async()=>[]});
  for(const type of ['tw','kr','us','../tw',null,'https://example.com','toString','__proto__']) await assert.rejects(chart(type),{status:400});
  assert.equal(calls,0);
});
test('category switches share one feed and lookup, coalescing requests and refreshing expiry',async()=>{
  let calls=0, lookups=0, time=1000;
  const chart=createCharts({now:()=>time,ttl:100,fetchFeed:async()=>{calls++;return response([entry(10)]);},lookup:async()=>{lookups++;return [];}});
  await Promise.all([chart('mandopop'),chart('kpop')]);assert.equal(calls,1);assert.equal(lookups,1);
  await chart('mandopop');await chart('kpop');assert.equal(calls,1);
  time=1200;await chart('kpop');assert.equal(calls,2);assert.equal(lookups,2);
});
test('valid chart without matching genre returns empty category, not unrelated fallback songs',async()=>{
  const chart=createCharts({fetchFeed:async()=>response([entry(10)]),lookup:async()=>[]});
  assert.deepEqual((await chart('kpop')).songs,[]);
});
test('failed or empty feeds are not cached and allow a clean retry',async()=>{
  let calls=0;
  const chart=createCharts({fetchFeed:async()=>response(++calls===1?[]:[entry(10)]),lookup:async()=>[]});
  await assert.rejects(chart('mandopop'),{status:502});
  assert.equal((await chart('mandopop')).songs.length,1);assert.equal(calls,2);
});
test('lookup throttling remains actionable',async()=>{
  const chart=createCharts({fetchFeed:async()=>response([entry(10)]),lookup:async()=>{throw Object.assign(new Error('Wait'),{status:429});}});
  await assert.rejects(chart('mandopop'),{status:429});
});
