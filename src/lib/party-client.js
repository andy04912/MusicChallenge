import { request } from "./api.js";
export const partyPath = (code, action = "") =>
  `/api/parties/${encodeURIComponent(code)}${action ? `/${action}` : ""}`;
export const partyAction = (room, action, body = {}) =>
  request(partyPath(room.code, action), {
    method: "POST",
    body: JSON.stringify({ ...body, roundId: room.roundId }),
  });
export function subscribeParty(code, onState, onConnection) {
  const stream = new EventSource(partyPath(code, "events"));
  stream.onopen = () => onConnection(true);
  stream.onerror = () => onConnection(false);
  stream.addEventListener("state", (event) => {
    try {
      onState(JSON.parse(event.data));
      onConnection(true);
    } catch {
      onConnection(false);
    }
  });
  return () => stream.close();
}
export function partyInviteOrigin(current, choices = []) {
  try {
    const url = new URL(current);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return url.origin;
    const allowed = choices.filter((value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    });
    return allowed[0] || url.origin;
  } catch {
    return current;
  }
}
