const PLAYER_NAME_KEY = "music-challenge-player-name";

export function readPlayerName(fallback = "") {
  try {
    const saved = localStorage.getItem(PLAYER_NAME_KEY)?.trim().slice(0, 20);
    return saved || fallback;
  } catch {
    return fallback;
  }
}

// Save each edit, including incomplete input, without making storage availability
// a prerequisite for playing. Submission can trim the displayed name separately.
export function savePlayerName(value) {
  const name = String(value ?? "").slice(0, 20);
  try {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // Private browsing or disabled storage must not interrupt the input.
  }
  return name;
}
