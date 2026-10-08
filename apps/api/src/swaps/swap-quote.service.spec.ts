import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { SwapQuoteService } from './swap-quote.service.js';

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
      const url = String(input);
      if (url.includes('api.0x.org')) {
        return Response.json({ buyAmount: '1000', gas: '21000' });
      }
      if (url.includes('1inch.dev')) {
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

    await expect(service.quote({ ...request, buyToken: request.sellToken })).rejects.toThrow(/different/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
