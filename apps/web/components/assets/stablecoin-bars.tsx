import { tokens } from '@/lib/brand/tokens';
import type { StablecoinBar } from '@/lib/queries/assets';
import { fmtUsd } from '@/lib/format';

interface Props {
  bars: StablecoinBar[];
}

const BIG_STABLES = new Set(['USDC', 'USDT', 'DAI']);

export function StablecoinBars({ bars }: Props) {
  if (bars.length === 0) {
    return <div className="text-small uppercase tracking-header-medium text-text-muted">No stablecoin supply</div>;
  }
  const max = bars[0]?.supplyUsd ?? 1;
  return (
    <div className="space-y-1.5">
      {bars.map((b) => {
        const w = max > 0 ? (b.supplyUsd / max) * 100 : 0;
        // Color rules: Ethena stack in accent (highlight), the big three
        // (USDC/USDT/DAI) in muted brand grey, everything else in accent-muted.
        const color = b.isEthena
          ? tokens.colors.accent
          : BIG_STABLES.has(b.symbol.toUpperCase())
            ? 'hsla(0, 0%, 100%, 0.30)'
            : 'hsla(266, 100%, 75%, 0.55)'; // accent-secondary at lower alpha
        return (
          <div key={b.symbol} className="flex items-center gap-3 text-body">
            <div className="w-24 shrink-0 uppercase tracking-header-medium text-text-secondary">
              {b.symbol}
            </div>
            <div className="relative h-5 flex-1 rounded-sm bg-background overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{ width: `${w.toFixed(3)}%`, background: color }}
              />
            </div>
            <div className="w-24 shrink-0 text-right tabular-nums text-text-primary">
              {fmtUsd(b.supplyUsd, { compact: true })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
