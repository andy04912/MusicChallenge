import { expect, test } from "vitest";
import { partyInviteOrigin, partyPath } from "./party-client.js";
test("local invites use supplied LAN origin while production always uses its own origin", () => {
  expect(
    partyInviteOrigin("http://127.0.0.1:8080", ["http://192.168.1.4:8080"]),
  ).toBe("http://192.168.1.4:8080");
  expect(
    partyInviteOrigin("https://music.example", ["http://192.168.1.4:8080"]),
  ).toBe("https://music.example");
  expect(
    partyInviteOrigin("http://localhost:8080", ["javascript:alert(1)"]),
  ).toBe("http://localhost:8080");
  expect(partyPath("Ab_Cd-eF", "events")).toBe("/api/parties/Ab_Cd-eF/events");
});
