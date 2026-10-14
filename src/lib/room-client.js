import { subscribeLive } from "./live-connection.js";
import { request } from "./api.js";

export const validRoomCode = (value) =>
  /^[A-Za-z0-9_-]{6,32}$/.test(String(value || ""));
export const roomPath = (code, action = "") =>
  `/api/rooms/${encodeURIComponent(code)}${action ? `/${action}` : ""}`;
export const roomAction = (state, action, body = {}, options = {}) =>
  request(roomPath(state.code, action), {
    ...options,
    method: "POST",
    body: JSON.stringify({ ...body, revision: state.me?.revision }),
  });

export function subscribeRoom(code, onState, onConnection, onExpired) {
  return subscribeLive(
    roomPath(code, "events"),
    onState,
    onConnection,
    onExpired,
  );
}
