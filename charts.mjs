import { excludedVersionReason } from './classify.mjs';
// One Taiwan chart, split by Apple's genre metadata. Never use the Korea chart.
const chartTypes = {
  mandopop: { genreId: '1253', region: 'tw', label: '華語' },
  kpop: { genreId: '51', region: 'kr', label: 'K-POP' }
};
export function createCharts({ lookup, fetchFeed = fetch, now = Date.now, ttl = 30 * 60 * 1000 }) {
  let cached, pending;
  async function loadTaiwanChart() {
    if (cached && now() - cached.cachedAt < ttl) return cached.data;
    if (pending) return pending;
    pending = (async () => {
      const sourceUrl = 'https://rss.marketingtools.apple.com/api/v2/tw/music/most-played/100/songs.json';
      const response = await fetchFeed(sourceUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Apple chart ${response.status}`);
      const { feed } = await response.json();
      if (!Array.isArray(feed?.results) || !feed.results.length) throw new Error('Empty Apple chart');
      const validEntries = feed.results.slice(0, 100).map((song, index) => ({ ...song, rank: index + 1, id: Number(song.id) })).filter(song => Number.isSafeInteger(song.id) && song.id > 0);
      if (!validEntries.length) throw new Error('Invalid Apple chart');
      const entries = validEntries.filter(entry => !excludedVersionReason({ title: entry.name, artist: entry.artistName }));
      const previews = new Map((entries.length ? await lookup(entries.map(s => s.id)) : []).map(song => [song.id, song]));
      const data = {
        storefront: 'tw', updatedAt: feed.updated || null,
        fetchedAt: new Date(now()).toISOString(), sourceUrl,
        songs: entries.map(entry => {
          const song = previews.get(entry.id);
          return { id: entry.id, title: entry.name, artist: entry.artistName, album: '', artwork: entry.artworkUrl100 || '', url: entry.url,
            year: (entry.releaseDate || '').slice(0, 4), category: 'other', preview: null,
            ...song, rank: entry.rank, unavailable: !song,
            genreIds: (entry.genres || []).map(genre => String(genre.genreId)) };
        }).filter(song => !excludedVersionReason(song))
      };
      cached = { cachedAt: now(), data };
      return data;
    })();
    try { return await pending; }
    catch (error) {
      if (error.status === 429) throw error;
      throw Object.assign(new Error('Apple 台灣排行榜暫時無法載入，請稍後再試。'), { status: 502 });
    } finally { pending = null; }
  }
  return async function getChart(type) {
    if (!Object.hasOwn(chartTypes, type)) throw Object.assign(new Error('請選擇華語或 K-POP。'), { status: 400 });
    const config = chartTypes[type], data = await loadTaiwanChart();
    return { ...data, type, region: config.region, title: `台灣熱門・${config.label}`,
      songs: data.songs.filter(song => song.genreIds.includes(config.genreId)).map(({ genreIds, ...song }) => ({ ...song, region: config.region })) };
  };
}
