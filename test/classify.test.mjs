import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySong } from '../classify.mjs';
const classify = (title, artist) => classifySong({ id: 42, title, artist });
test('same lead artist can have solo and mixed song classifications', () => {
  assert.equal(classify('Solo song', 'ROSÉ').category, 'girl');
  assert.equal(classify('APT.', 'ROSÉ & Bruno Mars').category, 'other');
  assert.equal(classify('Duet (feat. Bruno Mars)', 'ROSÉ').category, 'other');
  assert.equal(classify('Duet (feat. Bruno Mars)', 'ROSÉ').categoryReview, 0);
  assert.equal(classify('Collaboration (feat. JENNIE)', 'ROSÉ').category, 'girl');
  assert.equal(classify('Duet (feat. A-Lin)', '周興哲').category, 'other');
  assert.equal(classify('Solo song', '周興哲').category, 'boy');
});
test('an unknown participant makes the whole song pending, never mixed by default', () => {
  for (const [title, artist] of [['Song','Unknown'], ['Song (feat. Unknown)','TWICE'], ['Song','BTS & Unknown'], ['Song','告五人'], ['Song (feat.)','BTS']]) {
    assert.equal(classify(title, artist).categoryReview, 1);
  }
});
test('whole act names are resolved before collaboration separators', () => {
  assert.equal(classify('Song','TOMORROW X TOGETHER').category,'boy');
  assert.equal(classify('Song','伍佰 & China Blue').category,'boy');
  assert.equal(classify('Song','(G)I-DLE').category,'girl');
  assert.equal(classify('Song','BTS, SEVENTEEN & Stray Kids').category,'boy');
});
test('unknown versions and missing metadata require review; exact song metadata prevents ID-only matches', () => {
  for(const title of ['Song (Instrumental)','Song (Remix)','']) assert.equal(classify(title,'TWICE').categoryReview,1);
  assert.equal(classifySong({id:1824672652,title:'Different song',artist:'Unknown'}).categoryReview,1);
  assert.equal(classifySong({id:1824672652,title:'JUMP',artist:'BLACKPINK'}).categoryReview,0);
});
