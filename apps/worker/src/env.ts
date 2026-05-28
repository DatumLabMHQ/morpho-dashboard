export interface Env {
  // Neon Postgres connection. `wrangler secret put DATABASE_URL`.
  DATABASE_URL: string;
  // Bearer token required for POST /sync/* and POST /backfill/tick.
  // `wrangler secret put ADMIN_TOKEN`.
  ADMIN_TOKEN: string;
  // Plain var from wrangler.toml — 'production' or 'development'.
  ENVIRONMENT: string;
  // Optional FRED API key for the 3-month T-bill feed (series DTB3).
  // `wrangler secret put FRED_API_KEY`. When unset, fred-tbill no-ops and
  // the /overview real-yield-spread KPI renders "—".
  FRED_API_KEY?: string;
}
