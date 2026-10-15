import { test } from "node:test";
import assert from "node:assert/strict";
import { makePartyPatch, applyPartyPatch } from "../party-wire.mjs";

test("wire deltas reconstruct joins, removals, ranking, private feedback and equal-revision presence", () => {
  let current = {
    id: "room",
    revision: 2,
    status: "lobby",
    preview: null,
    answer: null,
    hostConnected: false,
    me: { id: "a", feedback: "" },
    players: [{ id: "a", score: 0, rank: 1 }],
  };
  const changes = [
    {
      revision: 3,
      players: [
        { id: "a", score: 0, rank: 1 },
        { id: "b", score: 0, rank: 2 },
      ],
    },
    { hostConnected: true },
    {
      revision: 6,
      status: "playing",
      players: [
        { id: "b", score: 1000, rank: 1 },
        { id: "a", score: 0, rank: 2 },
      ],
    },
    { revision: 7, me: { id: "a", feedback: "wrong" } },
    { revision: 8, players: [{ id: "a", score: 0, rank: 1 }] },
    { revision: 9, status: "revealed", answer: { title: "Song" } },
    { revision: 10, status: "ready", answer: null },
  ];
  for (const change of changes) {
    const next = { ...current, ...change },
      before = JSON.stringify(current);
    const patch = JSON.parse(JSON.stringify(makePartyPatch(current, next)));
    assert.deepEqual(applyPartyPatch(current, patch), next);
    assert.equal(JSON.stringify(current), before);
    assert.equal(patch.changes.preview, undefined);
    current = next;
  }
  assert.throws(
    () =>
      applyPartyPatch(current, {
        baseRevision: 1,
        changes: {},
        players: { changes: [] },
      }),
    /full snapshot/,
  );
  assert.throws(
    () =>
      applyPartyPatch(current, {
        baseRevision: 10,
        changes: {},
        players: { changes: [], order: ["missing"] },
      }),
    /Invalid party/,
  );
});
