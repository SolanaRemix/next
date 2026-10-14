import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SwapQuoteService } from './swap-quote.service.js';
import type { RedisThrottlerStorage } from '../throttling/redis-throttler.storage.js';

const request = {
  chainId: 1,
  sellToken: '0x0000000000000000000000000000000000000001',
  buyToken: '0x0000000000000000000000000000000000000002',
  sellAmount: '1000000',
  sellDecimals: 6,
  buyDecimals: 18,
  maxSlippageBps: 500,
};

describe('SwapQuoteService', () => {
  const service = new SwapQuoteService();
  const originalOneInchKey = process.env.ONEINCH_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalOneInchKey === undefined) delete process.env.ONEINCH_API_KEY;
    else process.env.ONEINCH_API_KEY = originalOneInchKey;
  });

  it('compares aggregator output, ranks the best quote, and derives minimum output', async () => {
    process.env.ONEINCH_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const hostname = new URL(String(input)).hostname;
      if (hostname === 'api.0x.org') {
        return Response.json({ buyAmount: '1000', gas: '21000' });
      }
      if (hostname === 'api.1inch.dev') {
        return Response.json({ dstAmount: '1200', gas: 22000 });
      }
      return Response.json({ priceRoute: { destAmount: '1100', gasCost: '23000' } });
    }));

    const result = await service.quote(request);

    expect(result.routes.map((route) => route.provider)).toEqual(['1inch', 'paraswap', '0x']);
    expect(result.routes[0]?.minimumBuyAmount).toBe('1140');
    expect(result.routes[1]?.minimumBuyAmount).toBe('1045');
    expect(result.routes[0]?.estimatedGas).toBe('22000');
    expect(result.unavailableProviders).toEqual([]);
    expect(result).not.toHaveProperty('transaction');
    expect(result).not.toHaveProperty('calldata');
  });

  it('returns available quotes when one provider is unavailable', async () => {
    delete process.env.ONEINCH_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('paraswap')) {
        return Response.json({ priceRoute: { destAmount: '2000' } });
      }
      return new Response('{}', { status: 503 });
    }));

    const result = await service.quote(request);

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.provider).toBe('paraswap');
    expect(result.unavailableProviders).toEqual(['0x', '1inch']);
  });

  it('fails closed when no aggregator provides a quote', async () => {
    delete process.env.ONEINCH_API_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));

    await expect(service.quote(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects same-token swap requests before contacting providers', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(service.quote({ ...request, buyToken: request.sellToken })).rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares exact-input quote results for three seconds using an opaque request key', async () => {
    process.env.ONEINCH_API_KEY = 'test-key';
    const quoteEntries = new Map<string, string>();
    const getQuoteCache = vi.fn(async (key: string) => quoteEntries.get(key) ?? null);
    const setQuoteCache = vi.fn(async (key: string, value: string, ttlMs: number) => {
      quoteEntries.set(key, value);
    });
    const cache = { getQuoteCache, setQuoteCache } as unknown as RedisThrottlerStorage;
    const quoteService = new SwapQuoteService(cache);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const hostname = new URL(String(input)).hostname;
      if (hostname === 'api.0x.org') return Response.json({ buyAmount: '1000' });
      if (hostname === 'api.1inch.dev') return Response.json({ dstAmount: '1200' });
      return Response.json({ priceRoute: { destAmount: '1100' } });
    });
    vi.stubGlobal('fetch', fetch);

    const first = await quoteService.quote(request);
    const second = await quoteService.quote(request);
    const cacheKey = getQuoteCache.mock.calls[0]?.[0];

    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(setQuoteCache).toHaveBeenCalledOnce();
    expect(setQuoteCache.mock.calls[0]?.[2]).toBe(3_000);
    expect(cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(cacheKey).not.toContain(request.sellToken);
    expect(cacheKey).not.toContain(request.buyToken);
  });

  it('does not reuse cached routes for a different amount and ignores malformed cached entries', async () => {
    process.env.ONEINCH_API_KEY = 'test-key';
    const getQuoteCache = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ routes: [] }))
      .mockResolvedValueOnce(null);
    const setQuoteCache = vi.fn().mockResolvedValue(undefined);
    const quoteService = new SwapQuoteService({
      getQuoteCache,
      setQuoteCache,
    } as unknown as RedisThrottlerStorage);
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const hostname = new URL(String(input)).hostname;
      if (hostname === 'api.0x.org') return Response.json({ buyAmount: '1000' });
      if (hostname === 'api.1inch.dev') return Response.json({ dstAmount: '1200' });
      return Response.json({ priceRoute: { destAmount: '1100' } });
    });
    vi.stubGlobal('fetch', fetch);

    await quoteService.quote(request);
    await quoteService.quote({ ...request, sellAmount: '2000000' });

    expect(fetch).toHaveBeenCalledTimes(6);
    expect(getQuoteCache.mock.calls[0]?.[0]).not.toBe(getQuoteCache.mock.calls[1]?.[0]);
    expect(setQuoteCache).toHaveBeenCalledTimes(2);
  });
});
