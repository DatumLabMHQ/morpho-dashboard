export interface Env {
  // Neon Postgres connection. `wrangler secret put DATABASE_URL`.
  DATABASE_URL: string;
  // Bearer token required for POST /sync/* and POST /backfill/tick.
  // `wrangler secret put ADMIN_TOKEN`.
  ADMIN_TOKEN: string;
  // Plain var from wrangler.toml — 'production' or 'development'.
  ENVIRONMENT: string;
}
