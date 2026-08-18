import Link from 'next/link';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { PerChainCard as CardData } from '@/lib/queries/overview';

interface Props {
  card: CardData;
  /** Palette index for the chain's colored dot (matches market-share chart). */
  colorIndex: number;
}

// Architecture badge per chain. Falls back to "EVM CHAIN".
const ARCH: Record<string, string> = {
  ethereum: 'L1',
  base: 'OP-STACK L2',
  arbitrum: 'L2 ROLLUP',
  optimism: 'OP-STACK L2',
  polygon: 'L2',
  unichain: 'OP-STACK L2',
  ink: 'OP-STACK L2',
  mode: 'OP-STACK L2',
  soneium: 'OP-STACK L2',
  worldchain: 'OP-STACK L2',
  lisk: 'OP-STACK L2',
  scroll: 'ZK-ROLLUP',
  linea: 'ZK-ROLLUP',
  hyperliquid: 'L1',
  'hyperliquid-l1': 'L1',
  katana: 'L2',
  plasma: 'L1',
  sonic: 'L1',
  fraxtal: 'OP-STACK L2',
  berachain: 'L1',
  bsc: 'L1',
  'bnb-chain': 'L1',
  avalanche: 'L1',
  gnosis: 'L1',
  celo: 'L1',
  tac: 'L1',
  etherlink: 'L2',
  plume: 'L2',
  blast: 'OP-STACK L2',
};

const archBadge = (slug: string, name: string): string => {
  const key = slug.toLowerCase().replace(/\s+/g, '-');
  return ARCH[key] ?? ARCH[name.toLowerCase().replace(/\s+/g, '-')] ?? 'EVM CHAIN';
};

const Row = ({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) => (
  <div className="flex items-center justify-between gap-2 py-1 border-b border-card-border last:border-0">
    <span className="text-tiny uppercase tracking-header-medium text-text-muted">{label}</span>
    <span className="tabular-nums text-small" style={color ? { color } : { color: 'var(--text-primary)' }}>
      {children}
    </span>
  </div>
);

/**
 * One chain rendered as a 7-row stat card. Whole card is a click target
 * routing to /chains/{slug}. Header carries a colored dot + chain name +
 * architecture badge.
 */
export function PerChainCardTile({ card, colorIndex }: Props) {
  const dot = tokens.colors.chart[colorIndex % tokens.colors.chart.length];
  const netColor = card.netDeposits30d == null
    ? 'var(--text-muted)'
    : card.netDeposits30d >= 0 ? 'var(--success)' : 'var(--danger)';

  return (
    <Link
      href={`/chains/${card.slug}`}
      className="tui-card bg-card-bg border border-card-border rounded p-4 flex flex-col gap-1 hover:border-accent/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-card-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block size-2 rounded-sm shrink-0" style={{ background: dot }} />
          <span className="truncate text-small uppercase tracking-header-medium text-text-primary">{card.name}</span>
        </div>
        <span
          className="shrink-0 rounded border border-card-border px-1.5 py-0.5 text-[9px] uppercase tracking-header-medium text-text-muted"
        >
          {archBadge(card.slug, card.name)}
        </span>
      </div>

      <Row label="Total Deposits">{fmtUsd(card.deposits, { compact: true })}</Row>
      <Row label="TVL">{fmtUsd(card.tvl, { compact: true })}</Row>
      <Row label="Borrows">{fmtUsd(card.borrows, { compact: true })}</Row>
      <Row label="Utilization">{card.utilization == null ? 'N/A' : `${(card.utilization * 100).toFixed(1)}%`}</Row>
      <Row label="Fees 7d">{fmtUsd(card.fees7d, { compact: true })}</Row>
      <Row label="Revenue 30d">{fmtUsd(card.revenue30d, { compact: true })}</Row>
      <Row label="Net Deposits 30d" color={netColor}>
        {card.netDeposits30d == null
          ? 'N/A'
          : `${card.netDeposits30d >= 0 ? '+' : '−'}${fmtUsd(Math.abs(card.netDeposits30d), { compact: true })}`}
      </Row>
    </Link>
  );
}
