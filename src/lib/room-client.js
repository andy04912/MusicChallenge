import { request } from "./api.js";

export const validRoomCode = (value) =>
  /^[A-Za-z0-9_-]{6,32}$/.test(String(value || ""));
export const roomPath = (code, action = "") =>
  `/api/rooms/${encodeURIComponent(code)}${action ? `/${action}` : ""}`;
export const roomAction = (state, action, body = {}) =>
  request(roomPath(state.code, action), {
    method: "POST",
    body: JSON.stringify({ ...body, revision: state.me?.revision }),
  });

export function subscribeRoom(code, onState, onConnection) {
  const source = new EventSource(roomPath(code, "events"));
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false);
  source.addEventListener("state", (event) => {
    try {
      onState(JSON.parse(event.data));
      onConnection(true);
    } catch {
      onConnection(false);
    }
  });
  return () => source.close();
}
