import { readFileSync } from 'node:fs';
// Curated performer metadata, not a guess from names, nationality or audio pitch.
// Unknown credits stay pending; group aliases are matched before splitting credits.
const artists = JSON.parse(readFileSync(new URL('./seeds/vocal-artists.json', import.meta.url), 'utf8'));
const seeds = JSON.parse(readFileSync(new URL('./seeds/catalog.json', import.meta.url), 'utf8'));
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const performers = new Map(Object.entries(artists).flatMap(([category, names]) => names.flatMap(name => name.split('|').map(alias => [normalize(alias), category]))));
const knownSongs = new Map(seeds.map(song => [song.id, song]));
const pending = reason => ({ category: 'other', categoryReview: 1, categorySource: 'auto', categoryReason: reason });
function credits(value) {
  if (performers.has(normalize(value))) return [value];
  return value.split(/\s*(?:,|、|，|&|＆|;|；|\bfeat\.?|\bfeaturing|\bft\.?)\s*|\s+(?:and|with|x|×)\s+/iu).map(value => value.trim()).filter(Boolean);
}
export function classifySong(song) {
  const title = normalize(song.title), artist = normalize(song.artist);
  if (!title || !artist) return pending('缺少歌曲或演唱者資料');
  if (/\b(?:instrumental|karaoke|remix)\b|伴奏|純音樂|混音/iu.test(title)) return pending('特殊版本需確認實際演唱者');
  const known = knownSongs.get(song.id);
  if (known && normalize(known.title) === title && normalize(known.artist) === artist) {
    return { category: known.category, categoryReview: 0, categorySource: 'auto', categoryReason: '已確認的歌曲版本' };
  }
  const participants = credits(song.artist);
  const features = [...song.title.matchAll(/(?:\bfeat\.?|\bfeaturing|\bft\.?|[（(]with)\s+([^()（）\[\]]+)/giu)];
  for (const feature of features) participants.push(...credits(feature[1].trim()));
  if (/(?:feat\.?|featuring|ft\.?)\s*[)）]?$/iu.test(title)) return pending('合作演唱者資料不完整');
  const categories = participants.map(name => performers.get(normalize(name)));
  if (!categories.length || categories.some(value => !value)) return pending('演唱者或合作名單尚未確認');
  const category = new Set(categories).size > 1 ? 'other' : categories[0];
  return { category, categoryReview: 0, categorySource: 'auto', categoryReason: `依本曲演唱名單：${[...new Set(participants)].join('、')}` };
}
export function manualCategory(category) {
  return { category: category === 'pending' ? 'other' : category, categoryReview: category === 'pending' ? 1 : 0, categorySource: 'manual', categoryReason: category === 'pending' ? '人工標記待確認' : '人工確認此曲分類' };
}

// Match explicit version/credit markers, never artist gender or "Live" substrings.
export function excludedVersionReason(song) {
  const title = String(song.title || '').normalize('NFKC');
  const artist = String(song.artist || '').normalize('NFKC');
  const album = String(song.album || '').normalize('NFKC');
  const featured = /(?:^|[^\p{L}\p{N}])(?:feat\.?|ft\.?|featuring)(?=$|[^\p{L}\p{N}])/iu;
  if (featured.test(title) || featured.test(artist)) return 'Feat 合作版本';
  const live = /[(\[][^()[\]]*\blive\b[^()[\]]*[)\]]|(?:^|\s[-–—:]\s*)live(?:$|\s+(?:at|from|in|version|session|recording|20\d{2}|19\d{2})\b)|\blive\s+(?:version|session|recording)\b|(?:現場|现场)(?:版|錄音|录音|演出|實錄|实录)|演唱[會会](?:版|現場|现场|實錄|实录|全紀錄|全纪录)|[(\[]\s*(?:現場|现场|ライブ)\s*[)\]]/iu;
  if (live.test(title) || live.test(album)) return 'Live 現場版本';
  return null;
}
