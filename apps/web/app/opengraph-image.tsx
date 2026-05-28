/**
 * Root-level OG image (1200×630) for the Morpho Research Terminal.
 *
 * Renders a branded card via Next.js's `opengraph-image.tsx` file convention.
 * Used as the Twitter / X / Slack / Discord preview when the site root is
 * shared. Kept fully static — no DB / API calls — because:
 *   1. OG crawlers cache the rendered PNG for 24h-7d on most platforms, so
 *      "live" numbers would be misleading anyway.
 *   2. Edge-runtime fetches would slow first-paint of the route and add a
 *      failure mode that's annoying to debug remotely.
 *   3. The brand + chain footprint story is the durable hook, not whatever
 *      the TVL happened to be five minutes ago.
 *
 * Matches the Lending Intelligence Terminal OG card pattern (same orange
 * #FF6B35, same dark bg, same DATUMLABS RESEARCH eyebrow) with chain chips
 * replacing the protocol chips.
 */
import { ImageResponse } from 'next/og';

export const alt = 'Morpho Research Terminal · Multi-chain Morpho analytics';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const runtime = 'edge';

// Chain chips — the chains Morpho is live on. Color order mirrors the
// dashboard's brand palette. Kept inline so the edge route ships with zero
// runtime imports beyond next/og.
const CHAINS: { name: string; color: string }[] = [
  { name: 'Ethereum',     color: '#6B85FF' },
  { name: 'Base',         color: '#0052FF' },
  { name: 'Arbitrum',     color: '#28A0F0' },
  { name: 'Polygon',      color: '#8247E5' },
  { name: 'Optimism',     color: '#FF0420' },
  { name: 'Hyperliquid',  color: '#34D399' },
  { name: 'Unichain',     color: '#F472B6' },
  { name: 'Linea',        color: '#FBBF24' },
];

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          background: '#0B0D11',
          color: '#F7F4ED',
          fontFamily: 'sans-serif',
          padding: '56px 72px',
          position: 'relative',
        }}
      >
        {/* Subtle accent gradient for the terminal feel */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(135deg, rgba(185, 122, 255, 0.04) 0%, rgba(255, 107, 53, 0.06) 100%)',
          }}
        />

        {/* Eyebrow: brand mark + product label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              background: '#FF6B35',
              borderRadius: '50%',
            }}
          />
          <span
            style={{
              fontSize: 16,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: '#FF6B35',
              fontWeight: 600,
            }}
          >
            DatumLabs Research
          </span>
          <span
            style={{
              fontSize: 14,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'rgba(247, 244, 237, 0.45)',
              marginLeft: 4,
            }}
          >
            · Live terminal
          </span>
        </div>

        {/* Title block */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            marginTop: 42,
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
              color: '#F7F4ED',
              display: 'flex',
            }}
          >
            Morpho Research
          </div>
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
              color: '#FF6B35',
              display: 'flex',
            }}
          >
            Terminal
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.3,
              color: 'rgba(247, 244, 237, 0.78)',
              maxWidth: 900,
              marginTop: 6,
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            Multi-chain Morpho Blue analytics — markets, vaults, curators,
            rates and asset composition in one screen.
          </div>
        </div>

        {/* Spacer pushes the chain strip to the bottom */}
        <div style={{ flex: 1 }} />

        {/* Chain chips row */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            position: 'relative',
            marginBottom: 28,
          }}
        >
          {CHAINS.map((c) => (
            <div
              key={c.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 18px',
                background: 'rgba(20, 23, 29, 0.85)',
                border: '1px solid rgba(247, 244, 237, 0.12)',
                borderLeft: `3px solid ${c.color}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: c.color,
                }}
              />
              <span
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: c.color,
                }}
              >
                {c.name}
              </span>
            </div>
          ))}
        </div>

        {/* Footer: domain + tagline */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 22,
            borderTop: '1px solid rgba(247, 244, 237, 0.14)',
            fontSize: 16,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'rgba(247, 244, 237, 0.62)',
            position: 'relative',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#FF6B35', fontWeight: 700 }}>&gt;</span>
            <span>datumlab.xyz/morpho-terminal</span>
          </span>
          <span>Beyond Analytics · Beyond Reports · Beyond Ordinary</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
