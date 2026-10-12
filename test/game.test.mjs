import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterPool,
  searchSongs,
  isCorrectGuess,
  pointsForTime,
} from "../src/lib/game-logic.js";
const songs = [
  { id: 1, title: "七里香", artist: "周杰倫", region: "tw", category: "other" },
  { id: 2, title: "稻香", artist: "周杰倫", region: "tw", category: "other" },
  {
    id: 3,
    title: "How You Like That",
    artist: "BLACKPINK",
    region: "kr",
    category: "girl",
  },
  {
    id: 4,
    title: "How You Like That",
    artist: "BLACKPINK",
    region: "kr",
    category: "girl",
  },
  {
    id: 5,
    title: "七里香",
    artist: "Cover artist",
    region: "other",
    category: "other",
  },
];
test("region and artist-type filters intersect without including unclassified songs", () => {
  assert.deepEqual(
    filterPool(songs, "tw").map((s) => s.id),
    [1, 2],
  );
  assert.deepEqual(
    filterPool(songs, "kr", "girl").map((s) => s.id),
    [3, 4],
  );
  assert.deepEqual(filterPool(songs, "tw", "girl"), []);
  assert.equal(filterPool(songs).length, 2);
  assert.deepEqual(filterPool(songs, "all"), []);
  assert.deepEqual(filterPool(songs, "other"), []);
});
test("autocomplete searches artist, title and combined text; deduplicates album versions", () => {
  assert.equal(searchSongs(songs, "周杰倫").length, 2);
  assert.equal(searchSongs(songs, "ｂｌａｃｋｐｉｎｋ")[0].id, 3);
  assert.equal(searchSongs(songs, "周杰倫 七里香")[0].id, 1);
  assert.equal(searchSongs(songs, "七里香").length, 2);
  assert.equal(searchSongs(songs, "").length, 0);
  assert.equal(searchSongs(filterPool(songs, "kr"), "周杰倫").length, 0);
  assert.equal(searchSongs(songs, "周杰倫", 1).length, 1);
});
test("free text tolerates punctuation, casing and fullwidth but not partial titles or artist-only guesses", () => {
  assert.equal(isCorrectGuess(songs[2], " ＨＯＷ you-like that! "), true);
  assert.equal(isCorrectGuess(songs[2], "BLACKPINK"), false);
  assert.equal(isCorrectGuess(songs[2], "How You"), false);
  assert.equal(isCorrectGuess(songs[0], "七里香"), true);
  assert.equal(isCorrectGuess(songs[0], "？！"), false);
});
test("selected songs accept another album version but reject a different artist with the same title", () => {
  assert.equal(isCorrectGuess(songs[2], songs[3].title, songs[3]), true);
  assert.equal(isCorrectGuess(songs[0], songs[4].title, songs[4]), false);
});

test("speed scoring includes exact boundaries, rejects invalid time and retains late-answer points", () => {
  for (const [ms, points] of [
    [0, 1000],
    [1000, 1000],
    [1001, 800],
    [3000, 800],
    [3001, 600],
    [5000, 600],
    [5001, 400],
    [10000, 400],
    [10001, 200],
    [20000, 200],
    [20001, 100],
    [60000, 100],
    [-1, 0],
    [NaN, 0],
    [Infinity, 0],
    [null, 0],
  ]) {
    assert.equal(pointsForTime(ms), points, `elapsed ${ms}`);
  }
});
