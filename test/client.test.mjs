// Mocked tests: no network. `npm test` builds first.
import test from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  AuthenticationError,
  RateLimitError,
  DatasetUnavailableError,
  InvalidRequestError,
} from "../dist/index.js";

function fake(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const [status, body, headers = {}] = responses.shift();
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const type = typeof body === "string" ? "text/csv" : "application/json";
    return new Response(text, { status, headers: { "content-type": type, ...headers } });
  };
  return { fn, calls };
}
const make = (responses, opts = {}) => {
  const f = fake(responses);
  return { dk: new Client({ apiKey: "dk_test", baseUrl: "https://example.test", fetch: f.fn, ...opts }), calls: f.calls };
};

test("keyless call sends no Authorization", async () => {
  const { dk, calls } = make([[200, { feed: "pick6-board", props: [] }]]);
  const out = await dk.publicBoard({ league: "nba", limit: 2 });
  assert.equal(out.feed, "pick6-board");
  assert.equal(calls[0].url.pathname, "/api/v1/public/board");
  assert.equal(calls[0].url.searchParams.get("league"), "nba");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("status and history coverage live at the root", async () => {
  const { dk, calls } = make([[200, { status: "ok" }], [200, {}], [200, { data: [] }]]);
  await dk.status();
  await dk.historyCoverage();
  await dk.creditCosts({ path: "/api/v1/odds", rows: 500 });
  assert.deepEqual(calls.map((c) => c.url.pathname), ["/status.json", "/history-coverage.json", "/api/v1/credit-costs"]);
  assert.equal(calls[2].url.searchParams.get("rows"), "500");
});

test("demo rejects unknown datasets", () => {
  const { dk } = make([]);
  assert.throws(() => dk.demo("nope"), RangeError);
});

test("keyed call without a key throws before fetching", async () => {
  const { dk, calls } = make([], { apiKey: "" });
  dk.apiKey = undefined;
  await assert.rejects(dk.odds({ sport: "NFL" }), (e) => e instanceof AuthenticationError && /sign-up/.test(e.message));
  assert.equal(calls.length, 0);
});

test("bearer key, task header and required args", async () => {
  const { dk, calls } = make([[200, { data: [] }], [200, { data: [] }]], { userRequest: "Build a prop screen" });
  await dk.pick6LineHistory("123", { change_type: "line_move" });
  await dk.statsPlayerGames("NBA", 2026, { athlete_id: "9" });
  assert.equal(calls[0].init.headers.Authorization, "Bearer dk_test");
  assert.equal(decodeURIComponent(calls[0].init.headers["X-User-Request"]), "Build a prop screen");
  assert.equal(calls[0].url.searchParams.get("pickable_id"), "123");
  assert.equal(calls[1].url.searchParams.get("season"), "2026");
});

test("csv comes back as text", async () => {
  const { dk } = make([[200, "id,line\n1,20.5\n"]]);
  const out = await dk.dfsPlayers({ sport: "NFL", format: "csv" });
  assert.ok(out.startsWith("id,line"));
});

test("errors carry the API message", async () => {
  const { dk } = make([
    [401, { error: { code: 401, type: "invalid_api_key", message: "Invalid API key." } }],
    [429, { error: { code: 429, type: "minute_rate_limited", message: "Slow down.", limit: "minute" } }, { "retry-after": "12" }],
    [503, { error: { code: 503, type: "service_unavailable", message: "Dataset unavailable." } }],
    [400, { error: { code: 400, type: "invalid_query", message: "Invalid input", query_help: { x: 1 } } }],
  ]);
  await assert.rejects(dk.odds(), (e) => e instanceof AuthenticationError && e.status === 401 && e.message === "Invalid API key.");
  await assert.rejects(dk.ev(), (e) => e instanceof RateLimitError && e.retryAfter === 12 && e.error.limit === "minute");
  await assert.rejects(dk.publicBoard(), (e) => e instanceof DatasetUnavailableError);
  await assert.rejects(dk.odds({ limit: 99999 }), (e) => e instanceof InvalidRequestError && e.error.query_help.x === 1);
});

test("paginate follows next_cursor and next, with a budget", async () => {
  const { dk, calls } = make([
    [200, { data: [1, 2], pagination: { has_more: true, next_cursor: "c2" } }],
    [200, { data: [3], pagination: { has_more: false, next_cursor: null } }],
    [200, { data: ["a"], pagination: { has_more: true, next: "k:1" } }],
    [200, { data: ["b"], pagination: { has_more: false, next: null } }],
    ...Array(5).fill([200, { data: [0], pagination: { has_more: true, next_cursor: "x" } }]),
  ]);
  const rows = [];
  for await (const r of dk.paginate((p) => dk.odds(p), { sport: "NFL", offset: 50 })) rows.push(r);
  assert.deepEqual(rows, [1, 2, 3]);
  assert.equal(calls[0].url.searchParams.get("offset"), null);
  assert.equal(calls[1].url.searchParams.get("cursor"), "c2");
  const stats = [];
  for await (const r of dk.paginate((p) => dk.statsGames("NBA", 2026, p))) stats.push(r);
  assert.deepEqual(stats, ["a", "b"]);
  assert.equal(calls[3].url.searchParams.get("after"), "k:1");
  let n = 0;
  for await (const _ of dk.paginate((p) => dk.odds(p), {}, 3)) n++;
  assert.equal(n, 3);
});
