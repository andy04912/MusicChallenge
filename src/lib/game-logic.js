// Compare text without casing, spacing or punctuation differences. Preserve
// letters, numbers and diacritics so unrelated titles do not become equal.
export const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, "");
export const songKey = (song) =>
  `${normalize(song.title)}|${normalize(song.artist)}`;
export const filterPool = (songs, region = "kr", category = "all") =>
  songs.filter(
    (song) =>
      ["tw", "kr"].includes(region) &&
      song.region === region &&
      (category === "all" || song.category === category),
  );

export const scoreTiers = [
  { until: 1000, points: 1000, label: "≤ 1 秒" },
  { until: 3000, points: 800, label: "1–3 秒" },
  { until: 5000, points: 600, label: "3–5 秒" },
  { until: 10000, points: 400, label: "5–10 秒" },
  { until: 20000, points: 200, label: "10–20 秒" },
  { until: Infinity, points: 100, label: "> 20 秒" },
];
export function pointsForTime(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return scoreTiers.find((tier) => elapsedMs <= tier.until).points;
}
export function searchSongs(songs, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const seen = new Set();
  return songs
    .filter((song) => {
      const key = songKey(song);
      if (seen.has(key)) return false;
      seen.add(key);
      return (
        normalize(song.title).includes(q) ||
        normalize(song.artist).includes(q) ||
        normalize(`${song.artist} ${song.title}`).includes(q) ||
        normalize(`${song.title} ${song.artist}`).includes(q)
      );
    })
    .sort(
      (a, b) =>
        Number(normalize(b.title) === q) - Number(normalize(a.title) === q) ||
        a.title.localeCompare(b.title, "zh-Hant"),
    )
    .slice(0, limit);
}
export function isCorrectGuess(answer, text, selectedSong = null) {
  if (selectedSong) return songKey(answer) === songKey(selectedSong);
  const input = normalize(text);
  return !!input && input === normalize(answer.title);
}
