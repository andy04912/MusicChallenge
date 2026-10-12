// Public Apple chart metadata only. Audio continues to stream directly from Apple.
export function createCharts({ lookup, fetchFeed = fetch, now = Date.now, ttl = 30 * 60 * 1000 }) {
  const cache = new Map(), pending = new Map();
  return async function getChart(region) {
    if (!['tw', 'kr'].includes(region)) throw Object.assign(new Error('請選擇台灣或韓國排行榜。'), { status: 400 });
    const saved = cache.get(region);
    if (saved && now() - saved.cachedAt < ttl) return saved.data;
    if (pending.has(region)) return pending.get(region);
    const task = (async () => {
      const sourceUrl = `https://rss.marketingtools.apple.com/api/v2/${region}/music/most-played/50/songs.json`;
      const response = await fetchFeed(sourceUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Apple chart ${response.status}`);
      const { feed } = await response.json();
      if (!Array.isArray(feed?.results) || !feed.results.length) throw new Error('Empty Apple chart');
      const entries = feed.results.slice(0, 50).map((song, index) => ({ ...song, rank: index + 1, id: Number(song.id) })).filter(song => Number.isSafeInteger(song.id) && song.id > 0);
      if (!entries.length) throw new Error('Invalid Apple chart');
      // Keep the site's TW preview storefront. Never replace unavailable IDs with
      // similarly named covers/remixes or claim an unavailable song is playable.
      const previews = new Map((await lookup(entries.map(s => s.id))).map(song => [song.id, song]));
      const data = {
        region, title: region === 'tw' ? '台灣熱門 Top 50' : '韓國熱門 Top 50',
        updatedAt: feed.updated || null, fetchedAt: new Date(now()).toISOString(), sourceUrl,
        songs: entries.map(entry => {
          const song = previews.get(entry.id);
          return { id: entry.id, title: entry.name, artist: entry.artistName, album: '', artwork: entry.artworkUrl100 || '', url: entry.url,
            year: (entry.releaseDate || '').slice(0, 4), category: 'other', preview: null,
            ...song, rank: entry.rank, unavailable: !song };
        })
      };
      cache.set(region, { cachedAt: now(), data });
      return data;
    })();
    pending.set(region, task);
    try { return await task; }
    catch (error) {
      if (error.status === 429) throw error;
      throw Object.assign(new Error('Apple 排行榜暫時無法載入，請稍後再試。'), { status: 502 });
    } finally { pending.delete(region); }
  };
}
