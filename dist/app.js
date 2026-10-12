const $ = (id) => document.getElementById(id);
const audio = new Audio();
audio.preload = 'none';
audio.autoplay = false;
let catalog = [], mix = 'all', rounds = [], round = 0, score = 0, history = [], revealed = false, playRequest = 0;
const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
};
const seconds = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
function appleURL(song) {
  // Keep Apple's actual catalog identifier and path, targeting the music storefront.
  const url = new URL(song.url);
  if (!['music.apple.com', 'itunes.apple.com'].includes(url.hostname)) return 'https://music.apple.com/tw/';
  url.hostname = 'music.apple.com';
  url.searchParams.set('app', 'music');
  return url.href;
}
function show(screen) {
  for (const name of ['home', 'game', 'results']) $(name).hidden = name !== screen;
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function stopAudio() {
  playRequest++;
  audio.pause();
  audio.currentTime = 0;
  $('audio-progress').style.width = '0%';
  $('audio-time').textContent = '00:00 / 試聽片段';
  $('play').disabled = false;
  updatePlayState();
}
function updatePlayState() {
  const playing = !audio.paused;
  $('play').textContent = playing ? 'Ⅱ' : '▶';
  $('play').setAttribute('aria-label', playing ? '暫停試聽' : '播放試聽');
  $('play-label').textContent = playing ? '正在播放試聽' : audio.ended ? '再聽一次' : '聽聽這首歌';
}
function start() {
  const pool = catalog.filter(s => mix === 'all' || s.category === mix);
  if (pool.length < 5) { $('load-status').textContent = '這個分類目前曲目不足，請選擇其他分類。'; return; }
  rounds = shuffle(pool).slice(0, 5);
  score = 0; round = 0; history = [];
  show('game');
  loadRound();
}
function loadRound() {
  stopAudio();
  revealed = false;
  const song = rounds[round];
  audio.removeAttribute('src');
  audio.load();
  audio.src = song.preview;
  audio.load();
  audio.pause();
  updatePlayState();
  $('score').textContent = score;
  $('round-counter').textContent = `TRACK ${String(round + 1).padStart(2, '0')} / 05`;
  $('round-track').replaceChildren(...rounds.map((_, i) => { const el = document.createElement('span'); el.className = `round-mark ${i === round ? 'current' : i < round ? 'done' : ''}`; return el; }));
  $('round-track').setAttribute('aria-label', `第 ${round + 1} 題，共 5 題`);
  $('guess-panel').hidden = false; $('reveal-panel').hidden = true;
  $('mystery-art').hidden = false; $('answer-art').hidden = true;
  $('audio-error').textContent = '';
  $('source-link').href = appleURL(song);
  $('listen-kicker').textContent = 'TUNE IN. GUESS IT.';
  const seen = new Set([song.title.toLowerCase()]);
  const distractors = shuffle(catalog.filter(s => s.category === song.category)).filter(s => { const key = s.title.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 3);
  $('options').replaceChildren(...shuffle([song, ...distractors]).map((choice, index) => {
    const button = document.createElement('button'); button.className = 'option';
    const letter = document.createElement('span'); letter.textContent = 'ABCD'[index];
    const title = document.createElement('span'); title.textContent = choice.title;
    button.append(letter, title);
    button.addEventListener('click', () => reveal(choice.id));
    return button;
  }));
  $('play').focus({ preventScroll: true });
}
function reveal(selectedId) {
  if (revealed) return;
  revealed = true;
  const song = rounds[round], correct = selectedId === song.id, skipped = selectedId === null;
  if (correct) score += 100;
  history.push({ song, correct, skipped });
  $('score').textContent = score;
  $('guess-panel').hidden = true; $('reveal-panel').hidden = false;
  $('mystery-art').hidden = true;
  $('answer-art').src = song.artwork.replace('100x100bb', '600x600bb');
  $('answer-art').alt = `${song.album} 專輯封面`;
  $('answer-art').hidden = false;
  $('listen-kicker').textContent = 'FOUND YOUR NEXT FAVORITE?';
  $('verdict').textContent = correct ? '答對了！你的雷達很準。 +100' : skipped ? '讓這首歌，加入你的音樂宇宙。' : '差一點！認識一首好歌，也算收穫。';
  $('answer-title').textContent = song.title;
  $('answer-artist').textContent = song.artist;
  $('answer-album').textContent = `${song.album} · ${song.year}`;
  $('answer-feedback').textContent = correct ? '這個旋律果然難不倒你。喜歡的歌，值得再聽一次。' : `答案是 ${song.artist} 的〈${song.title}〉。下次前奏響起，你就認得了。`;
  $('apple-link').href = appleURL(song);
  $('next').replaceChildren(document.createTextNode(round === 4 ? '看看本輪成績 ' : '下一首 '), Object.assign(document.createElement('span'), { textContent: '→' }));
  $('next').focus({ preventScroll: true });
}
function finish() {
  stopAudio();
  show('results');
  $('final-score').textContent = score / 100;
  $('results-title').textContent = score === 500 ? '全中！你就是人形歌單。' : score >= 300 ? '你的 K-pop 雷達，很靈。' : '新歌單，已經有了靈感。';
  $('results-description').textContent = `本輪獲得 ${score} 分。${score === 500 ? '五首歌都逃不過你的耳朵。' : '每一次聆聽，都離喜歡的音樂更近一點。'}`;
  $('song-history').replaceChildren(...history.map(({ song, correct, skipped }) => {
    const row = document.createElement('div'); row.className = 'history-row';
    const img = document.createElement('img'); img.src = song.artwork; img.alt = `${song.album} 專輯封面`; img.loading = 'lazy';
    const info = document.createElement('div'); info.className = 'history-info';
    const title = document.createElement('strong'); title.textContent = song.title;
    const artist = document.createElement('p'); artist.textContent = `${song.artist} · ${song.year}`;
    info.append(title, artist);
    const status = document.createElement('span'); status.className = 'history-status' + (!correct ? ' skipped' : ''); status.textContent = correct ? '猜中了' : skipped ? '已揭曉' : '新發現';
    const link = document.createElement('a'); link.href = appleURL(song); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Apple Music ↗'; link.setAttribute('aria-label', `在 Apple Music 聆聽 ${song.title}`);
    row.append(img, info, status, link); return row;
  }));
  $('again').focus({ preventScroll: true });
}
$('play').addEventListener('click', async () => {
  if (!audio.paused) { audio.pause(); return; }
  const request = ++playRequest;
  $('audio-error').textContent = '';
  $('play-label').textContent = '正在載入試聽…';
  $('play').disabled = true;
  if (audio.ended) audio.currentTime = 0;
  try { await audio.play(); }
  catch { if (request === playRequest) { $('audio-error').textContent = '暫時無法播放，可能是網路或地區限制。請再試一次，或直接揭曉歌曲。'; updatePlayState(); } }
  finally { if (request === playRequest) $('play').disabled = false; }
});
audio.addEventListener('play', updatePlayState);
audio.addEventListener('pause', updatePlayState);
audio.addEventListener('ended', updatePlayState);
audio.addEventListener('timeupdate', () => {
  if (!Number.isFinite(audio.duration)) return;
  $('audio-progress').style.width = `${audio.currentTime / audio.duration * 100}%`;
  $('audio-time').textContent = `${seconds(audio.currentTime)} / ${seconds(audio.duration)}`;
});
audio.addEventListener('error', () => { if (!$('game').hidden) { $('audio-error').textContent = '此片段目前無法載入，請重試或直接揭曉，再前往 Apple Music 聆聽。'; $('play').disabled = false; updatePlayState(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); });
$('start').addEventListener('click', start);
$('skip').addEventListener('click', () => reveal(null));
$('next').addEventListener('click', () => { if (!revealed) return; if (round === 4) finish(); else { round++; loadRound(); } });
$('exit').addEventListener('click', () => { stopAudio(); show('home'); });
$('again').addEventListener('click', () => { show('home'); $('start').focus({ preventScroll: true }); });
document.querySelectorAll('.mix').forEach(button => button.addEventListener('click', () => {
  mix = button.dataset.mix;
  document.querySelectorAll('.mix').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
  updateCatalogUI();
}));
$('how-button').addEventListener('click', () => $('how-dialog').showModal());
$('close-dialog').addEventListener('click', () => $('how-dialog').close());
$('how-dialog').addEventListener('click', event => { if (event.target === $('how-dialog')) { const rect = $('how-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('how-dialog').close(); } });
function updateCatalogUI() {
  const pool = catalog.filter(song => mix === 'all' || song.category === mix);
  const artists = [...new Set(pool.map(song => song.artist))];
  $('artist-list').replaceChildren(...artists.map(artist => { const el = document.createElement('div'); el.className = 'artist-chip'; el.textContent = artist; const count = document.createElement('small'); count.textContent = `${pool.filter(s => s.artist === artist).length} tracks`; el.append(count); return el; }));
  $('load-status').textContent = `${pool.length} 首精選 · 每輪 5 題 · 不需登入`;
}
async function init() {
  try {
    const response = await fetch('./catalog.json');
    if (!response.ok) throw new Error('Catalog unavailable');
    const data = await response.json();
    catalog = data.filter(song => song.id && song.title && song.preview?.startsWith('https://') && song.url);
    if (catalog.length < 5) throw new Error('Catalog incomplete');
    updateCatalogUI();
    $('start').disabled = false;
    $('start').replaceChildren(document.createTextNode('開始猜歌 '), Object.assign(document.createElement('span'), { textContent: '↗' }));
  } catch {
    $('load-status').textContent = '題庫載入失敗，請確認網路連線後重試。';
    $('start').disabled = false;
    $('start').textContent = '重新載入題庫';
    $('start').removeEventListener('click', start);
    $('start').onclick = () => { $('start').disabled = true; $('start').onclick = null; $('start').addEventListener('click', start); init(); };
  }
}
init();
