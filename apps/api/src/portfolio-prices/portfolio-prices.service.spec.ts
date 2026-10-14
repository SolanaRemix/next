import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortfolioPricesService } from './portfolio-prices.service.js';

const tokenAddress = '0x2222222222222222222222222222222222222222';

function createService(apiKey = 'test-api-key'): PortfolioPricesService {
  const config = { get: vi.fn(() => apiKey) } as unknown as ConfigService;
  return new PortfolioPricesService(config);
}

describe('PortfolioPricesService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns validated native and tracked-token reference prices', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/simple/price')) {
        return Response.json({ ethereum: { usd: 3_000 } });
      }
      expect(url.pathname).toBe('/api/v3/simple/token_price/ethereum');
      expect(url.searchParams.get('contract_addresses')).toBe(tokenAddress);
      return Response.json({ [tokenAddress]: { usd: 1 } });
    });
    vi.stubGlobal('fetch', fetch);

    const result = await createService().getEvmPrices('0x1', [tokenAddress]);

    expect(result).toMatchObject({
      chainId: '0x1',
      nativePriceUsd: 3_000,
      tokenPrices: [{ address: tokenAddress, priceUsd: 1 }],
      source: 'CoinGecko',
    });
    expect(Number.isFinite(Date.parse(result.asOf))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of fetch.mock.calls) {
      expect(options?.headers).toHaveProperty('x-cg-demo-api-key', 'test-api-key');
    }
  });

  it('preserves unknown token prices and returns partial results when one source fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/simple/price')) throw new Error('native price unavailable');
      return Response.json({});
    }));

    await expect(createService().getEvmPrices('0x1', [tokenAddress])).resolves.toMatchObject({
      nativePriceUsd: null,
      tokenPrices: [{ address: tokenAddress, priceUsd: null }],
    });
  });

  it('fails closed when configuration or all price providers are unavailable', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(createService('').getEvmPrices('0x1', [])).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetch).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 429 })));
    await expect(createService().getEvmPrices('0x1', [tokenAddress]))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(createService().getEvmPrices('0x1', []))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects unsupported chains and malformed or excessive token lists', async () => {
    const service = createService();
    await expect(service.getEvmPrices('0x999', [])).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.getEvmPrices('__proto__', [])).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.getEvmPrices('0x1', ['invalid'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getEvmPrices('0x1', Array(51).fill(tokenAddress))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prices Solana mainnet assets using case-sensitive token mint addresses', async () => {
    const mint = 'So11111111111111111111111111111111111111112';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/simple/price')) {
        expect(url.searchParams.get('ids')).toBe('solana');
        return Response.json({ solana: { usd: 150 } });
      }
      expect(url.pathname).toBe('/api/v3/simple/token_price/solana');
      expect(url.searchParams.get('contract_addresses')).toBe(mint);
      return Response.json({ [mint]: { usd: 150 } });
    }));

    await expect(createService().getSolanaPrices('mainnet-beta', [mint])).resolves.toMatchObject({
      chainId: 'mainnet-beta',
      nativePriceUsd: 150,
      tokenPrices: [{ address: mint, priceUsd: 150 }],
      source: 'CoinGecko',
    });
  });

  it('returns unknown Solana prices as null and rejects invalid networks or mints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ solana: { usd: 150 } })));
    await expect(createService().getSolanaPrices('devnet', []))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(createService().getSolanaPrices('mainnet-beta', ['invalid']))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(createService().getSolanaPrices('mainnet-beta', [tokenAddress]))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns partial Solana prices when the native-coin lookup fails', async () => {
    const mint = 'So11111111111111111111111111111111111111112';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/simple/price')) return Response.json({}, { status: 503 });
      return Response.json({ [mint]: { usd: 150 } });
    }));
    await expect(createService().getSolanaPrices('mainnet-beta', [mint])).resolves.toMatchObject({
      nativePriceUsd: null,
      tokenPrices: [{ address: mint, priceUsd: 150 }],
    });
  });
});
