# Deploy runbook: Morpho Research Terminal

Architecture (same as the Lending Terminal):

- **Web app (`apps/web`) -> Vercel.** Plain Next.js, no adapter. Reads from Neon
  with a read-only role.
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

## 2. Web app -> Vercel

Monorepo, so point Vercel at `apps/web`.

Dashboard route: New Project -> import the repo ->
- Root Directory: `apps/web`
- Framework preset: Next.js (build `next build`, output `.next`; no adapter)
- Environment variables:
  - `DATABASE_URL` = the **morpho_readonly** connection string from step 1
  - `NEXT_PUBLIC_SITE_URL` = `https://datumlab.xyz` (or the canonical host)

Or via CLI from `apps/web`:

```bash
cd apps/web
vercel link
vercel env add DATABASE_URL production        # paste read-only string
vercel env add NEXT_PUBLIC_SITE_URL production # https://datumlab.xyz
vercel --prod
```

Map the canonical path (e.g. `datumlab.xyz/morpho-terminal`) in Vercel domains,
or via a path rewrite on the apex host, matching the Lending Terminal setup.

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

On the Vercel URL, confirm:

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
