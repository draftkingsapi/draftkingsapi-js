/**
 * TypeScript client for draftkingsapi.com. Zero runtime dependencies; uses the global fetch (Node 18+, Deno, Bun,
 * browsers). draftkingsapi.com is independent and not affiliated with or endorsed by DraftKings.
 */

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://draftkingsapi.com";
export const SIGN_UP_URL = "https://draftkingsapi.com/sign-up";

export type Json = Record<string, unknown>;
export type ParamValue = string | number | boolean | null | undefined;
export type Params = Record<string, ParamValue>;

export interface Pagination {
  limit?: number;
  offset?: number;
  has_more: boolean;
  next_cursor?: string | null;
  next?: string | null;
  next_after?: string | number | null;
  [key: string]: unknown;
}

export interface Page<Row = Json> {
  data: Row[];
  pagination?: Pagination;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  error?: {
    code?: number;
    type?: string;
    message?: string;
    limit?: "month" | "day" | "minute" | "conditional";
    retry_after_seconds?: number;
    upgrade_url?: string;
    agent_next_step?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Any non-2xx response (status is the HTTP code) or a network failure (status 0). */
export class DraftKingsAPIError extends Error {
  readonly status: number;
  readonly type?: string;
  readonly body: ApiErrorBody;
  readonly retryAfter?: number;
  constructor(message: string, status = 0, type?: string, body: ApiErrorBody = {}, retryAfter?: number) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.type = type;
    this.body = body;
    this.retryAfter = retryAfter;
  }
  /** The error object from the response body. */
  get error() {
    return this.body.error ?? {};
  }
}
/** 400: a parameter was rejected; error.query_help often has a corrected example. */
export class InvalidRequestError extends DraftKingsAPIError {}
/** 401: missing or invalid API key. */
export class AuthenticationError extends DraftKingsAPIError {}
/** 402: needs a paid plan; error.upgrade_url opens checkout. */
export class PaymentRequiredError extends DraftKingsAPIError {}
/** 404: unknown route or record; error.closest_endpoints lists real ones. */
export class NotFoundError extends DraftKingsAPIError {}
/** 429: a limit was reached. Not charged. On error.limit === "month", stop retrying. */
export class RateLimitError extends DraftKingsAPIError {}
/** 503: dataset temporarily unavailable. Not charged. */
export class DatasetUnavailableError extends DraftKingsAPIError {}

const BY_STATUS: Record<number, typeof DraftKingsAPIError> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  402: PaymentRequiredError,
  404: NotFoundError,
  429: RateLimitError,
  503: DatasetUnavailableError,
};

export const DEMO_DATASETS = [
  "pick6",
  "dfs",
  "events",
  "odds",
  "history",
  "pick6-history",
  "coverage",
  "stats-games",
  "stats-player-games",
  "stats-team-games",
] as const;
export type DemoDataset = (typeof DEMO_DATASETS)[number];

export type PublicBoardLeague = "nfl" | "nba" | "nhl" | "cfb" | "cbb" | "soccer" | "mlb" | "ufc" | "cs" | "lol";
export type PublicSportsbookLeague = "nfl" | "nba" | "nhl" | "cfb" | "cbb" | "mlb" | "epl" | "mls";
export type StatsSport = "NBA" | "NFL" | "NHL" | "NCAAF" | "NCAAB" | "MLB" | "WNBA";

export interface ClientOptions {
  /** Your key (dk_...). Defaults to process.env.DRAFTKINGS_API_KEY where process exists. */
  apiKey?: string;
  baseUrl?: string;
  /** Milliseconds per request. Default 30000. */
  timeoutMs?: number;
  /** Optional one-sentence task, sent as X-User-Request. Never anything personal. */
  userRequest?: string;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Injectable fetch, used by the tests. */
  fetch?: typeof fetch;
}

const env = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

export class DraftKingsAPI {
  apiKey?: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  userRequest?: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  /** Response headers of the last call (rate-limit and quota headers live here). */
  lastHeaders: Record<string, string> = {};

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey ?? (env("DRAFTKINGS_API_KEY") || undefined);
    this.baseUrl = (options.baseUrl ?? env("DRAFTKINGS_API_BASE") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.userRequest = options.userRequest;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** GET a path such as /api/v1/odds. Returns parsed JSON, or text for format=csv. Throws DraftKingsAPIError subclasses. */
  async request<T = Json>(path: string, params: Params = {}, keyed = true): Promise<T> {
    if (keyed && !this.apiKey)
      throw new AuthenticationError(
        `This endpoint needs an API key. Set DRAFTKINGS_API_KEY or pass { apiKey }. Free key, no card: ${SIGN_UP_URL}`,
        401,
        "missing_api_key",
      );
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) query.set(k, String(v));
    const qs = query.toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { Accept: "application/json", ...this.headers };
    if (keyed && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (this.userRequest) headers["X-User-Request"] = encodeURIComponent(this.userRequest.slice(0, 500));
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new DraftKingsAPIError(`Could not reach ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.lastHeaders = Object.fromEntries(res.headers.entries());
    const text = await res.text();
    let body: unknown = text;
    if ((res.headers.get("content-type") ?? "").includes("json") || /^[[{]/.test(text)) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const data = (body && typeof body === "object" ? body : {}) as ApiErrorBody;
      const err = data.error ?? {};
      const header = res.headers.get("retry-after");
      const retryAfter = header && /^\d+$/.test(header) ? Number(header) : err.retry_after_seconds;
      const message = err.message ?? (typeof body === "string" && body ? body.slice(0, 2000) : `HTTP ${res.status}`);
      const Cls = BY_STATUS[res.status] ?? DraftKingsAPIError;
      throw new Cls(message, res.status, err.type, data, retryAfter);
    }
    return body as T;
  }

  /**
   * Iterate rows across pages of any list method, with a page budget. Follows pagination.next_cursor (as cursor),
   * pagination.next (stats routes, as after) or pagination.next_after (change feeds, as after).
   *
   *   for await (const row of dk.paginate((p) => dk.odds(p), { sport: "NBA" }, 5)) { ... }
   */
  async *paginate<Row = Json>(
    method: (params: Params) => Promise<unknown>,
    params: Params = {},
    maxPages = 10,
  ): AsyncGenerator<Row> {
    const p: Params = { ...params };
    delete p.offset;
    for (let i = 0; i < Math.max(1, maxPages); i++) {
      const page = (await method(p)) as Page<Row>;
      if (!page || typeof page !== "object") throw new TypeError("paginate() needs JSON pages; do not pass format=csv");
      const rows = page.data;
      if (Array.isArray(rows)) yield* rows;
      else if (rows != null) yield rows as Row;
      const pg = page.pagination;
      if (!pg?.has_more || !rows || (Array.isArray(rows) && rows.length === 0)) return;
      if (pg.next_cursor) p.cursor = pg.next_cursor;
      else if (pg.next) p.after = pg.next;
      else if (pg.next_after !== undefined && pg.next_after !== null && pg.next_after !== "") p.after = pg.next_after;
      else return;
    }
  }

  // Keyless: no key, no credits.
  /** Delayed, capped Pick6 board plus recent line moves. */
  publicBoard(params: { league?: PublicBoardLeague; limit?: number } = {}) {
    return this.request("/api/v1/public/board", params, false);
  }
  /** Sportsbook mainlines: moneyline, spread, total. */
  publicSportsbook(params: { league?: PublicSportsbookLeague; limit?: number } = {}) {
    return this.request("/api/v1/public/sportsbook", params, false);
  }
  /** Recent Pick6 and sportsbook line moves. */
  publicLineMoves(params: { league?: string; limit?: number; market?: "all" | "pick6" | "sportsbook" } = {}) {
    return this.request("/api/v1/public/line-moves", params, false);
  }
  /** Frozen sample rows to learn a response shape. Never use them as data. */
  demo(dataset: DemoDataset = "pick6", params: { limit?: number; sport?: string } = {}) {
    if (!DEMO_DATASETS.includes(dataset)) throw new RangeError(`dataset must be one of ${DEMO_DATASETS.join(", ")}`);
    return this.request(`/api/v1/demo/${dataset}`, params, false);
  }
  /** Credits each endpoint costs. */
  creditCosts(params: { path?: string; rows?: number } = {}) {
    return this.request("/api/v1/credit-costs", params, false);
  }
  /** Every route, the OpenAPI URL and docs. */
  directory() {
    return this.request("/api/v1", {}, false);
  }
  /** Measured collection status. */
  status() {
    return this.request("/status.json", {}, false);
  }
  /** Stored history start dates and capture counts by league. */
  historyCoverage() {
    return this.request("/history-coverage.json", {}, false);
  }

  // Keyed. Filters pass through unchanged; see https://draftkingsapi.com/openapi.json.
  coverage() {
    return this.request("/api/v1/coverage");
  }
  events(params: Params = {}) {
    return this.request<Page>("/api/v1/events", params);
  }
  odds(params: Params = {}) {
    return this.request<Page>("/api/v1/odds", params);
  }
  history(params: Params = {}) {
    return this.request<Page>("/api/v1/history", params);
  }
  pick6Projections(params: Params = {}) {
    return this.request<Page>("/api/v1/pick6/projections", params);
  }
  pick6History(params: Params = {}) {
    return this.request<Page>("/api/v1/pick6/history", params);
  }
  pick6LineHistory(pickableId: string, params: Params = {}) {
    return this.request<Page>("/api/v1/pick6/line-history", { ...params, pickable_id: pickableId });
  }
  projections(params: Params = {}) {
    return this.request<Page>("/api/v1/projections", params);
  }
  changes(params: Params = {}) {
    return this.request<Page>("/api/v1/changes", params);
  }
  dfsSports(params: Params = {}) {
    return this.request<Page>("/api/v1/dfs/sports", params);
  }
  dfsContests(params: Params = {}) {
    return this.request<Page>("/api/v1/dfs/contests", params);
  }
  dfsSlates(params: Params = {}) {
    return this.request<Page>("/api/v1/dfs/slates", params);
  }
  dfsPlayers(params: Params = {}) {
    return this.request<Page>("/api/v1/dfs/players", params);
  }
  dfsChanges(params: Params = {}) {
    return this.request<Page>("/api/v1/dfs/changes", params);
  }
  compare(params: Params = {}) {
    return this.request<Page>("/api/v1/compare", params);
  }
  compareBooks(params: Params = {}) {
    return this.request<Page>("/api/v1/compare/books", params);
  }
  ev(params: Params = {}) {
    return this.request<Page>("/api/v1/ev", params);
  }
  arbitrage(params: Params = {}) {
    return this.request<Page>("/api/v1/arbitrage", params);
  }
  statsGames(sport: StatsSport, season: number, params: Params = {}) {
    return this.request<Page>("/api/v1/stats/games", { ...params, sport, season });
  }
  statsPlayerGames(sport: StatsSport, season: number, params: Params = {}) {
    return this.request<Page>("/api/v1/stats/player-games", { ...params, sport, season });
  }
  statsTeamGames(sport: StatsSport, season: number, params: Params = {}) {
    return this.request<Page>("/api/v1/stats/team-games", { ...params, sport, season });
  }
  contextGames(params: Params = {}) {
    return this.request<Page>("/api/v1/context/games", params);
  }
  contextPlayerStats(params: Params = {}) {
    return this.request<Page>("/api/v1/context/player-stats", params);
  }
  contextTeamStats(params: Params = {}) {
    return this.request<Page>("/api/v1/context/team-stats", params);
  }
  sportsbookScopes() {
    return this.request("/api/v1/sportsbook/scopes");
  }
  sportsbookSnapshot(scope: string) {
    return this.request("/api/v1/sportsbook/snapshot", { scope });
  }
  streamSnapshot(params: { sport?: string } = {}) {
    return this.request("/api/v1/stream/snapshot", params);
  }
}

export { DraftKingsAPI as Client };
export default DraftKingsAPI;
