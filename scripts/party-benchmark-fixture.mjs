// Synthetic catalog, shared identically by both benchmark versions. Never sent
// to production and never fetched from its placeholder media URLs.
export const benchmarkSongs = Array.from({ length: 558 }, (_, i) => ({
  id: 10000 + i,
  title: `Benchmark Song ${String(i).padStart(3, "0")}`,
  artist: `Artist ${i % 80}`,
  region: i % 2 ? "tw" : "kr",
  category: i % 3 ? "girl" : "boy",
  year: String(2000 + (i % 25)),
  album: "Benchmark Album",
  artwork: `https://image.invalid/${"a".repeat(90)}/${i}.jpg`,
  preview: `https://audio.invalid/${"p".repeat(200)}/${i}.m4a`,
  url: `https://music.invalid/album/benchmark/${i}`,
}));
