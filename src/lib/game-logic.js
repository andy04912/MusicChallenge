// Compare text without casing, spacing or punctuation differences. Preserve
// letters, numbers and diacritics so unrelated titles do not become equal.
export const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}\s]/gu, "");
export const songKey = (song) =>
  `${normalize(song.title)}|${normalize(song.artist)}`;
export const decadeLabels = {
  all: "不限年代",
  "2000s": "2000–2009",
  "2010s": "2010–2019",
  "2020s": "2020–2029",
};
export function matchesDecade(year, decade = "all") {
  if (decade === "all") return true;
  const known = /^(19|20)\d{2}$/.test(String(year ?? ""));
  if (decade === "unknown") return !known;
  if (!known || !Object.hasOwn(decadeLabels, decade)) return false;
  const start = Number(decade.slice(0, 4));
  return Number(year) >= start && Number(year) < start + 10;
}
export const filterPool = (
  songs,
  region = "kr",
  category = "all",
  decade = "all",
) =>
  songs.filter(
    (song) =>
      ["tw", "kr"].includes(region) &&
      song.region === region &&
      !song.categoryReview &&
      matchesDecade(song.year, decade) &&
      (category === "all" || song.category === category),
  );

export const clipTiers = [
  { seconds: 1, points: 1000 },
  { seconds: 6, points: 800 },
  { seconds: 12, points: 600 },
  { seconds: 18, points: 400 },
  { seconds: 24, points: 200 },
  { seconds: Infinity, points: 100 },
];
export function stagesForDuration(duration = 0) {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 30;
  const stages = [];
  for (const tier of clipTiers) {
    stages.push({ ...tier, seconds: Math.min(tier.seconds, end) });
    if (tier.seconds >= end) break;
  }
  return stages;
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
