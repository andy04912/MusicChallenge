// Only diff already role-filtered public snapshots. Never feed internal room
// state into this module: host audio and private feedback must stay isolated.
const serialized = new WeakMap();
function json(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (!serialized.has(value)) serialized.set(value, JSON.stringify(value));
  return serialized.get(value);
}
const playerChanges = new WeakMap();
function diffPlayers(before, after) {
  let cached = playerChanges.get(before);
  if (!cached) playerChanges.set(before, (cached = new WeakMap()));
  if (cached.has(after)) return cached.get(after);
  const old = new Map(before.map((p) => [p.id, p]));
  const changes = [];
  for (const player of after) {
    const previous = old.get(player.id);
    const change = { id: player.id };
    for (const key of Object.keys(player))
      if (!previous || player[key] !== previous[key]) change[key] = player[key];
    if (!previous || Object.keys(change).length > 1) changes.push(change);
  }
  const sameOrder =
    before.length === after.length &&
    after.every((p, i) => p.id === before[i].id);
  const result = {
    changes,
    ...(sameOrder ? {} : { order: after.map((p) => p.id) }),
  };
  cached.set(after, result);
  return result;
}
export function makePartyPatch(before, after) {
  const changes = {};
  for (const key of Object.keys(after))
    if (key !== "players" && json(before[key]) !== json(after[key]))
      changes[key] = after[key];
  return {
    baseRevision: before.revision,
    changes,
    players: diffPlayers(before.players, after.players),
  };
}
export function applyPartyPatch(before, patch) {
  if (
    !before ||
    before.revision !== patch.baseRevision ||
    !patch.changes ||
    !Array.isArray(patch.players?.changes)
  )
    throw new Error("Party stream requires a full snapshot");
  const byId = new Map(before.players.map((p) => [p.id, p]));
  for (const change of patch.players.changes)
    byId.set(change.id, { ...byId.get(change.id), ...change });
  const ids = patch.players.order ?? before.players.map((p) => p.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id)))
    throw new Error("Invalid party player order");
  return {
    ...before,
    ...patch.changes,
    players: ids.map((id) => byId.get(id)),
  };
}
