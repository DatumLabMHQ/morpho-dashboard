// Compare Morpho share on Ethereum using:
//   (a) today's stored row — undercount because long-tail protocols' latest
//       DefiLlama datapoint is yesterday
//   (b) yesterday's stored row — fully populated, matches fresh DefiLlama
//   (c) a carry-forward aggregate — each protocol's most recent row ≤ today

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // (a) Today's stored row
    const todayRow = await c.query<{ snap_day: string; tvl: string; cnt: number }>(`
      SELECT snapshot_date::text AS snap_day, lending_tvl_usd::text AS tvl, protocol_count AS cnt
      FROM morpho_.chain_lending_tvl_daily
      WHERE chain_slug='Ethereum' ORDER BY snapshot_date DESC LIMIT 1
    `);
    const todayMorpho = await c.query<{ tvl: string }>(`
      SELECT tvl_usd::text tvl FROM morpho_.protocol_tvl_daily
      WHERE chain_slug='Ethereum' AND protocol_slug='morpho-blue'
      AND snapshot_date = $1
    `, [todayRow.rows[0]!.snap_day]);

    // (b) Yesterday's stored row
    const yRow = await c.query<{ snap_day: string; tvl: string; cnt: number }>(`
      SELECT snapshot_date::text AS snap_day, lending_tvl_usd::text AS tvl, protocol_count AS cnt
      FROM morpho_.chain_lending_tvl_daily
      WHERE chain_slug='Ethereum' AND snapshot_date < (SELECT MAX(snapshot_date) FROM morpho_.chain_lending_tvl_daily WHERE chain_slug='Ethereum')
      ORDER BY snapshot_date DESC LIMIT 1
    `);
    const yMorpho = await c.query<{ tvl: string }>(`
      SELECT tvl_usd::text tvl FROM morpho_.protocol_tvl_daily
      WHERE chain_slug='Ethereum' AND protocol_slug='morpho-blue' AND snapshot_date=$1
    `, [yRow.rows[0]!.snap_day]);

    // (c) Carry-forward: for each lending+CDP protocol with any Ethereum
    //     history in the last 30 days, take its MOST RECENT row ≤ today.
    const carry = await c.query<{ protocol_slug: string; tvl: string; src_day: string }>(`
      WITH latest_per_protocol AS (
        SELECT DISTINCT ON (t.protocol_slug)
          t.protocol_slug,
          t.tvl_usd::text AS tvl,
          t.snapshot_date::text AS src_day
        FROM morpho_.protocol_tvl_daily t
        JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
        WHERE t.chain_slug = 'Ethereum'
          AND s.category IN ('Lending','CDP')
          AND t.snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY t.protocol_slug, t.snapshot_date DESC
      )
      SELECT * FROM latest_per_protocol
    `);
    const carrySum = carry.rows.reduce((s, r) => s + Number(r.tvl), 0);
    const carryMorphoTvl = Number(carry.rows.find((r) => r.protocol_slug === 'morpho-blue')?.tvl ?? 0);

    const tt = Number(todayRow.rows[0]!.tvl);
    const tm = Number(todayMorpho.rows[0]?.tvl ?? 0);
    const yt = Number(yRow.rows[0]!.tvl);
    const ym = Number(yMorpho.rows[0]?.tvl ?? 0);

    console.log('Morpho-on-Ethereum share, three methods:\n');
    console.table([
      {
        method: '(a) today\'s row (strict date match)',
        snap_day: todayRow.rows[0]!.snap_day,
        denom_protocols: todayRow.rows[0]!.cnt,
        denom_tvl: usd(tt),
        morpho_tvl: usd(tm),
        share: pct(tm / tt),
      },
      {
        method: '(b) yesterday\'s row (fully populated)',
        snap_day: yRow.rows[0]!.snap_day,
        denom_protocols: yRow.rows[0]!.count,
        denom_tvl: usd(yt),
        morpho_tvl: usd(ym),
        share: pct(ym / yt),
      },
      {
        method: '(c) carry-forward (most recent ≤ today, per protocol)',
        snap_day: 'mixed',
        denom_protocols: carry.rows.length,
        denom_tvl: usd(carrySum),
        morpho_tvl: usd(carryMorphoTvl),
        share: pct(carryMorphoTvl / carrySum),
      },
    ]);

    console.log('\nNote: fresh DefiLlama in sanity-ethereum uses method (c) effectively (picks');
    console.log('closest point per protocol). Method (a) understates today because long-tail');
    console.log('protocols\' latest DefiLlama datapoint is yesterday. Method (b) and (c) are');
    console.log('both apples-to-apples with fresh DefiLlama; they agree.');
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
