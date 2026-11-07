# Deploy runbook: Morpho Research Terminal

Architecture (same as the Lending Terminal):

- **Web app (`apps/web`) -> Cloudflare Worker `morpho-terminal`.** Next.js app
  built with vinext (Vite) and deployed to Workers
  (`https://morpho-terminal.datumlabs.workers.dev`). Reads from Neon with a
  read-only role.
- **Cron / data sync (`apps/worker`) -> Cloudflare Worker.** Already configured
  in `apps/worker/wrangler.toml` (staggered 6h crons). Writes to Neon, so it
  uses a write-capable connection string, not the read-only one.

Steps that need credentials or publish access must be run by a human operator.

## 1. Two Neon roles (read vs write)

The web app only SELECTs; the worker INSERTs sync data. Use two connection
strings so the public-facing app cannot write.

- **Worker (write):** keep using the existing owner / write role connection
  string. The worker needs INSERT/UPDATE on the `morpho_` tables.
- **Web app (read-only):** create a least-privilege role. Run as the Neon
  project owner in the SQL editor. NOTE: this dashboard's tables live in the
  `morpho_` schema, not `public`:

```sql
CREATE ROLE morpho_readonly WITH LOGIN PASSWORD '<STRONG_PASSWORD>';
GRANT CONNECT ON DATABASE <db_name> TO morpho_readonly;
GRANT USAGE ON SCHEMA morpho_ TO morpho_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA morpho_ TO morpho_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA morpho_ GRANT SELECT ON TABLES TO morpho_readonly;
GRANT USAGE ON SCHEMA public TO morpho_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO morpho_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO morpho_readonly;
```

Verify read-only (first succeeds, second is denied):

```sql
SET ROLE morpho_readonly;
SELECT count(*) FROM morpho_.market_state_daily;        -- a number
INSERT INTO morpho_.market_state_daily (market_unique_key, snapshot_date)
  VALUES ('x', CURRENT_DATE);                            -- permission denied
RESET ROLE;
```

Read-only connection string (from Neon, role = morpho_readonly):
`postgresql://morpho_readonly:<password>@<host>/<db>?sslmode=require`

## 2. Web app -> Cloudflare Workers (vinext)

`apps/web` is built with [vinext](https://github.com/cloudflare/vinext) and
deployed as the Worker `morpho-terminal` on the Datum Labs account
(`accountId` is pinned in `apps/web/cloudflare.config.ts`). Worker settings
(name, compatibility flags, assets, Workers Cache for the `revalidate` pages)
live in `apps/web/cloudflare.config.ts` and `apps/web/vite.config.ts`. This is
separate from `apps/worker/wrangler.toml`, which only configures the cron
worker.

Secrets (set once per Worker, never committed):

- `DATABASE_URL` = the **morpho_readonly** connection string from step 1

`NEXT_PUBLIC_SITE_URL` is inlined at build time and defaults to
`https://datumlab.xyz`; export it before `pnpm build` only to use another host.

From `apps/web`:

```bash
cd apps/web
npx cf auth login                                               # once
npx cf workers secrets update DATABASE_URL --worker morpho-terminal   # paste read-only string
pnpm run deploy                                                 # vite build + upload
```

(or `pnpm deploy:web` from the repo root). Local commands: `pnpm dev`
(vite dev on :3000, runs in workerd), `pnpm build`, `pnpm start` (vite preview
of the built Worker). `pnpm dev:next` / `pnpm build:next` still run plain
Next.js. Locally, put `DATABASE_URL=...` in `apps/web/.dev.vars` (gitignored).

Map the canonical path (e.g. `datumlab.xyz/morpho-terminal`) with a Workers
route or custom domain on the apex zone, matching the Lending Terminal setup.

## 3. Cron worker -> Cloudflare

Already wired in `apps/worker/wrangler.toml`. From `apps/worker`:

```bash
cd apps/worker
wrangler login
wrangler secret put DATABASE_URL    # the WRITE connection string (owner/write role)
wrangler secret put ADMIN_TOKEN     # for POST /sync/* and /backfill/tick
wrangler deploy
```

This publishes `morpho-dashboard-worker` with its 6h cron triggers. Confirm in
the Cloudflare dashboard that the cron triggers are listed and the first
scheduled run succeeds (or hit the admin sync endpoint once to seed).

## 4. Smoke test (production)

On `https://morpho-terminal.datumlabs.workers.dev`, confirm:

- [ ] No 500s on `/`, `/chains`, `/curators`, `/vaults`, `/markets`, `/assets`, `/methodology`
- [ ] Last sync indicator (top right) shows a recent timestamp
- [ ] All charts render
- [ ] URL filters work: `/vaults?chain=base&minTvl=1000000`, `/markets?lltvRange=80-90`
- [ ] OG image resolves at `/og.png`
- [ ] `/methodology` renders all 7 sections
- [ ] `/nonsense` shows the branded 404

## 5. Final screenshots

At 1440px, save to `branding/production-{page}.png`:
`/`, `/chains`, `/chains/base`, `/curators`, `/curators/steakhouse-financial`,
`/assets`, `/assets/cbBTC`, `/vaults`, `/markets`, `/methodology`.
