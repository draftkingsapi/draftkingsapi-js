# DraftKings API for JavaScript and TypeScript: draftkingsapi

The DraftKings API client for Node.js, TypeScript, Deno, Bun and browsers. `npm install draftkingsapi` and read DraftKings sportsbook odds, Pick6 lines, DFS salaries and box scores with typed responses.

[Website](https://draftkingsapi.com/?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js) | [Docs](https://draftkingsapi.com/docs?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js) | [Free API key](https://draftkingsapi.com/auth/sign-up?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js) | [Pricing](https://draftkingsapi.com/pricing?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js) | [All SDKs](https://draftkingsapi.com/sdks?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js)

Also for draftkingsapi.com: [Python: `pip install draftkingsapi`](https://github.com/draftkingsapi/draftkingsapi-python) | [MCP server: `npx -y draftkingsapi-mcp`](https://github.com/draftkingsapi/draftkingsapi-mcp)

Client for [draftkingsapi.com](https://draftkingsapi.com/?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js): DraftKings Pick6 lines and line history, DFS salaries,
contests and slates, sportsbook odds and price history, and box scores. TypeScript types included, zero runtime
dependencies, uses the global `fetch` (Node 18+, Deno, Bun, browsers). ESM only.

draftkingsapi.com is an independent API. It is not affiliated with or endorsed by DraftKings. "DraftKings" is a
trademark of its owner and is used here only to describe the data.

```bash
npm install draftkingsapi
```

## No key needed

```js
import { Client } from "draftkingsapi";

const dk = new Client(); // reads DRAFTKINGS_API_KEY if set; keyless calls never send it

const board = await dk.publicBoard({ league: "nfl", limit: 3 });
for (const p of board.props) console.log(p.player, p.stat, p.line);

const sb = await dk.publicSportsbook({ league: "nba", limit: 1 });
const g = sb.games[0];
console.log(g.away, "at", g.home, g.markets.filter((m) => m.market === "spread").map((m) => `${m.side} ${m.line} ${m.american}`).join(", "));
```

Output, run on 15 Nov 2026 (live data, so yours will differ):

```text
Jameson Williams Receiving Yards 55.5
Amon-Ra St. Brown Receiving Yards 82.5
Sam LaPorta Receiving Yards 42.5
Oklahoma City Thunder at Sacramento Kings away -10.5 -108, home 10.5 -111
```

Other keyless calls: `publicLineMoves({ market: "pick6" })`, `demo("odds")` (frozen sample rows, for the shape
only), `creditCosts()`, `status()`, `historyCoverage()`, `directory()`.

## With a key

Free key (100 credits a month, no card): https://draftkingsapi.com/auth/sign-up?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js

```js
const dk = new Client({
  apiKey: process.env.DRAFTKINGS_API_KEY,
  userRequest: "Build a prop screen from current Pick6 lines", // optional, sent as X-User-Request
});

const lines = await dk.pick6Projections({ sport: "NBA", limit: 100 });
const moves = await dk.pick6LineHistory(String(lines.data[0].pickable_id), { change_type: "line_move" });
const odds = await dk.odds({ sport: "NFL", market: "moneyline" });
const csv = await dk.dfsPlayers({ sport: "NFL", format: "csv" }); // string
const box = await dk.statsPlayerGames("NBA", 2026, { limit: 50 });
const edges = await dk.ev({ league: "nba", min_edge: 2 });
```

### Pagination

```js
for await (const row of dk.paginate((p) => dk.odds(p), { sport: "NBA" }, 5)) {
  // at most 5 pages
}
```

Follows `pagination.next_cursor` (sent back as `cursor`), `pagination.next` on stats routes and
`pagination.next_after` on change feeds (both sent back as `after`).

### Errors

Non-2xx responses throw a subclass of `DraftKingsAPIError` with `status`, `type`, the API's `message`, `retryAfter`
(from `Retry-After`) and the full `error` object:

| Status | Class |
| --- | --- |
| 400 | `InvalidRequestError` (`e.error.query_help`) |
| 401 | `AuthenticationError` (also thrown before any request when a keyed method has no key) |
| 402 | `PaymentRequiredError` (`e.error.upgrade_url`) |
| 404 | `NotFoundError` (`e.error.closest_endpoints`) |
| 429 | `RateLimitError` (wait `e.retryAfter`; stop when `e.error.limit === "month"`) |
| 503 | `DatasetUnavailableError` (not charged, retry later) |

## Methods

Keyed: `coverage`, `events`, `odds`, `history`, `pick6Projections`, `pick6History`, `pick6LineHistory`,
`projections`, `changes`, `dfsSports`, `dfsContests`, `dfsSlates`, `dfsPlayers`, `dfsChanges`, `compare`,
`compareBooks`, `ev`, `arbitrage`, `statsGames`, `statsPlayerGames`, `statsTeamGames`, `contextGames`,
`contextPlayerStats`, `contextTeamStats`, `sportsbookScopes`, `sportsbookSnapshot`, `streamSnapshot`.

Filters pass through unchanged; each route's parameters are in the
[OpenAPI document](https://draftkingsapi.com/openapi.json) and the [docs](https://draftkingsapi.com/docs?utm_source=github&utm_medium=readme&utm_campaign=draftkingsapi-js).
Not wrapped: the server-sent event stream, the native sportsbook WebSocket, and account and billing routes.

Plans: Free 100 credits a month, Developer $49, Production $149, Scale $499 a month.

## Development

```bash
npm install
npm test            # builds with tsc, then mocked node:test suite
npm run test:live   # live keyless endpoints, no key, no credits
```

MIT License.
