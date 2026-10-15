import { subscribeLive } from "./live-connection.js";
import { request } from "./api.js";
export const partyPath = (code, action = "") =>
  `/api/parties/${encodeURIComponent(code)}${action ? `/${action}` : ""}`;
export const partyAction = (room, action, body = {}, options = {}) =>
  request(partyPath(room.code, action), {
    ...options,
    method: "POST",
    body: JSON.stringify({ ...body, roundId: room.roundId }),
  });
export function subscribeParty(code, onState, onConnection, onExpired) {
  return subscribeLive(
    `${partyPath(code, "events")}?compact=1`,
    onState,
    onConnection,
    onExpired,
  );
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
