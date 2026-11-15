// Opt-in live test of the keyless endpoints: DRAFTKINGS_LIVE=1 (npm run test:live). No key, no credits.
import test from "node:test";
import assert from "node:assert/strict";
import { Client, AuthenticationError } from "../dist/index.js";

const live = process.env.DRAFTKINGS_LIVE === "1";
const dk = new Client({ apiKey: "", userRequest: "Run the SDK live keyless test" });
dk.apiKey = undefined;

test("public board", { skip: !live }, async () => {
  const out = await dk.publicBoard({ league: "nba", limit: 2 });
  assert.equal(out.feed, "pick6-board");
  assert.ok(Array.isArray(out.props));
});
test("public sportsbook", { skip: !live }, async () => {
  const out = await dk.publicSportsbook({ league: "nfl", limit: 2 });
  assert.equal(out.feed, "sportsbook-mainlines");
});
test("line moves, demo, credit costs, status", { skip: !live }, async () => {
  assert.equal((await dk.publicLineMoves({ limit: 2 })).feed, "line-moves");
  assert.equal((await dk.demo("pick6")).demo.sample, true);
  assert.ok(Array.isArray((await dk.creditCosts()).data));
  assert.ok("status" in (await dk.status()));
});
test("keyed without key is a clear error", { skip: !live }, async () => {
  await assert.rejects(dk.odds(), AuthenticationError);
});
