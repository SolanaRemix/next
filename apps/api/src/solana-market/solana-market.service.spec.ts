import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { SolanaMarketService } from './solana-market.service.js';

const solMint = 'So11111111111111111111111111111111111111112';

describe('SolanaMarketService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('combines Jupiter token metadata/prices with multi-DEX market depth', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.jup.ag' && url.pathname.endsWith('/search')) {
        return Response.json([{
          id: solMint,
          symbol: 'SOL',
          name: 'Solana',
          decimals: 9,
          icon: 'https://cdn.example/sol.png',
        }]);
      }
      if (url.hostname === 'api.jup.ag') {
        return Response.json({ [solMint]: { usdPrice: 151 } });
      }
      return Response.json({
        pairs: [
          {
            chainId: 'solana',
            dexId: 'raydium',
            baseToken: { address: solMint, symbol: 'SOL', name: 'Solana' },
            priceUsd: '150',
            liquidity: { usd: 100_000 },
            volume: { h24: 50_000 },
          },
          {
            chainId: 'solana',
            dexId: 'orca',
            baseToken: { address: solMint, symbol: 'SOL', name: 'Solana' },
            priceUsd: '152',
            liquidity: { usd: 80_000 },
            volume: { h24: 25_000 },
          },
          {
            chainId: 'ethereum',
            dexId: 'uniswap',
            baseToken: { address: solMint, symbol: 'SOL', name: 'Solana' },
            priceUsd: '999',
            liquidity: { usd: 999_999 },
          },
        ],
      });
    }));

    const result = await new SolanaMarketService().search('SOL');

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({
      mint: solMint,
      symbol: 'SOL',
      logoUri: 'https://cdn.example/sol.png',
      priceUsd: 151,
      liquidityUsd: 100_000,
      volume24hUsd: 75_000,
      venues: ['orca', 'raydium'],
      priceSource: 'Jupiter',
    });
    expect(result.tokens[0]?.marketSpreadBps).toBeGreaterThan(0);
    expect(result.unavailableProviders).toEqual([]);
  });

  it('uses DEX Screener prices and metadata if Jupiter is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('api.jup.ag')) throw new Error('provider unavailable');
      return Response.json({
        pairs: [{
          chainId: 'solana',
          dexId: 'raydium',
          baseToken: { address: solMint, symbol: 'SOL', name: 'Solana' },
          priceUsd: '150',
          liquidity: { usd: 100_000 },
        }],
      });
    }));

    const result = await new SolanaMarketService().search('SOL');

    expect(result.tokens[0]).toMatchObject({
      mint: solMint,
      priceUsd: 150,
      priceSource: 'DEX Screener',
    });
    expect(result.unavailableProviders).toContain('Jupiter');
  });

  it('rejects provider failures when no live market source responds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('provider unavailable');
    }));

    await expect(new SolanaMarketService().search('SOL'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('ignores non-HTTPS logos and malformed token addresses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('api.jup.ag') && String(input).includes('/search')) {
        return Response.json([
          { id: solMint, symbol: 'SOL', name: 'Solana', icon: 'http://unsafe.example/logo.png' },
          { id: 'invalid', symbol: 'FAKE', name: 'Fake' },
        ]);
      }
      if (String(input).includes('api.jup.ag')) return Response.json({ [solMint]: { usdPrice: 150 } });
      return Response.json({ pairs: [] });
    }));

    const result = await new SolanaMarketService().search('SOL');
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.logoUri).toBeNull();
  });
});
