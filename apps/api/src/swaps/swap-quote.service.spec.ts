import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span, SpanOptions, Tracer } from '@opentelemetry/api';
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
    vi.restoreAllMocks();
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

  it('fans out only to enabled providers selected by administrator controls', async () => {
    const controls = {
      getEnabledProviders: vi.fn().mockResolvedValue(['paraswap']),
    };
    const quoteService = new SwapQuoteService(undefined, controls as never);
    const fetch = vi.fn(async () => Response.json({ priceRoute: { destAmount: '1100' } }));
    vi.stubGlobal('fetch', fetch);

    const result = await quoteService.quote(request);

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.routes.map((route) => route.provider)).toEqual(['paraswap']);
    expect(result.unavailableProviders).toEqual([]);
  });

  it('fails closed when administrator controls disable every quote provider', async () => {
    const controls = {
      getEnabledProviders: vi.fn().mockResolvedValue([]),
    };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const quoteService = new SwapQuoteService(undefined, controls as never);

    await expect(quoteService.quote(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetch).not.toHaveBeenCalled();
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
    const cache = {
      getQuoteCache,
      setQuoteCache,
      claimProviderCircuitAttempt: vi.fn().mockResolvedValue(true),
      recordProviderCircuitSuccess: vi.fn().mockResolvedValue(undefined),
      recordProviderCircuitFailure: vi.fn().mockResolvedValue(false),
    } as unknown as RedisThrottlerStorage;
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
      claimProviderCircuitAttempt: vi.fn().mockResolvedValue(true),
      recordProviderCircuitSuccess: vi.fn().mockResolvedValue(undefined),
      recordProviderCircuitFailure: vi.fn().mockResolvedValue(false),
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

  it('opens a failing provider circuit while continuing to return healthy aggregator quotes', async () => {
    process.env.ONEINCH_API_KEY = 'test-key';
    const failureCounts = new Map<string, number>();
    const claimProviderCircuitAttempt = vi.fn(async (provider: string) =>
      (failureCounts.get(provider) ?? 0) < 5);
    const recordProviderCircuitFailure = vi.fn(async (provider: string) => {
      failureCounts.set(provider, (failureCounts.get(provider) ?? 0) + 1);
      return (failureCounts.get(provider) ?? 0) >= 5;
    });
    const cache = {
      getQuoteCache: vi.fn().mockResolvedValue(null),
      setQuoteCache: vi.fn().mockResolvedValue(undefined),
      claimProviderCircuitAttempt,
      recordProviderCircuitSuccess: vi.fn().mockResolvedValue(undefined),
      recordProviderCircuitFailure,
    } as unknown as RedisThrottlerStorage;
    const quoteService = new SwapQuoteService(cache);
    const spanRecords: Array<{
      attributes: Record<string, unknown>;
      statusCodes: number[];
      ended: boolean;
    }> = [];
    const startActiveSpan = vi.fn(async (
      _name: string,
      _options: SpanOptions,
      callback: (span: Span) => Promise<unknown>,
    ) => {
      const record = { attributes: {}, statusCodes: [] as number[], ended: false };
      spanRecords.push(record);
      const span = {
        setAttribute: vi.fn((key: string, value: unknown) => {
          record.attributes[key] = value;
        }),
        setStatus: vi.fn((status: { code: number }) => {
          record.statusCodes.push(status.code);
        }),
        end: vi.fn(() => {
          record.ended = true;
        }),
      } as unknown as Span;
      return callback(span);
    });
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan,
    } as unknown as Tracer);
    const zeroXFetch = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const hostname = new URL(String(input)).hostname;
      if (hostname === 'api.0x.org') return zeroXFetch();
      if (hostname === 'api.1inch.dev') return Response.json({ dstAmount: '1800' });
      return Response.json({ priceRoute: { destAmount: '2000' } });
    }));

    let result: Awaited<ReturnType<SwapQuoteService['quote']>> | undefined;
    for (let index = 0; index < 6; index += 1) {
      result = await quoteService.quote({ ...request, sellAmount: String(1_000_000 + index) });
    }

    expect(zeroXFetch).toHaveBeenCalledTimes(5);
    expect(recordProviderCircuitFailure).toHaveBeenCalledTimes(5);
    expect(claimProviderCircuitAttempt).toHaveBeenCalledWith('0x', 10_000);
    expect(result?.routes.map((route) => route.provider)).toEqual(['paraswap', '1inch']);
    expect(result?.unavailableProviders).toContain('0x');
    expect(spanRecords.some((span) => span.attributes['app.quote.outcome'] === 'success')).toBe(true);
    expect(spanRecords.some((span) => span.attributes['app.quote.outcome'] === 'failure')).toBe(true);
    expect(spanRecords.some((span) => span.attributes['app.quote.outcome'] === 'circuit_open')).toBe(true);
    expect(spanRecords.every((span) => span.ended)).toBe(true);
    expect(spanRecords
      .find((span) => span.attributes['app.quote.outcome'] === 'failure')
      ?.statusCodes).toContain(SpanStatusCode.ERROR);
    expect(JSON.stringify(spanRecords)).not.toContain(request.sellToken);
    expect(JSON.stringify(spanRecords)).not.toContain(request.buyToken);
  });
});
