import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { PortfolioPricesService } from './portfolio-prices.service.js';
import { CrossChainPortfolioService } from './cross-chain-portfolio.service.js';

const wallet = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const tokenSymbol = `0x${Buffer.from('TOK').toString('hex').padEnd(64, '0')}`;
const decimals = `0x${18n.toString(16).padStart(64, '0')}`;
const tokenBalance = `0x${(10n ** 18n).toString(16).padStart(64, '0')}`;

function createService(
  prices: Partial<PortfolioPricesService> = {},
): CrossChainPortfolioService {
  const config = {
    get: vi.fn((key: string) => key === 'EVM_RPC_URL_1' ? 'https://rpc.example.test' : undefined),
  } as unknown as ConfigService;
  return new CrossChainPortfolioService(config, prices as PortfolioPricesService);
}

describe('CrossChainPortfolioService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads native and tracked EVM balances and adds complete reference pricing', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as {
        method: string;
        id: number;
        params: readonly unknown[];
      };
      const result = body.method === 'eth_getBalance'
        ? '0xde0b6b3a7640000'
        : body.method === 'eth_call' && typeof body.params[0] === 'object'
          && body.params[0] !== null && 'data' in body.params[0]
          ? body.params[0].data === '0x95d89b41'
            ? tokenSymbol
            : body.params[0].data === '0x313ce567'
              ? decimals
              : tokenBalance
          : null;
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    });
    vi.stubGlobal('fetch', fetch);
    const priceService = {
      getEvmPrices: vi.fn().mockResolvedValue({
        chainId: '0x1',
        nativePriceUsd: 2_000,
        tokenPrices: [{ address: token, priceUsd: 1 }],
        source: 'CoinGecko',
        asOf: new Date().toISOString(),
      }),
    };

    const result = await createService(priceService).aggregate([{
      address: wallet,
      chain: 'evm',
      chainId: '0x1',
      tokenAddresses: [token],
    }]);

    expect(result.complete).toBe(true);
    expect(result.totalUsd).toBe(2_001);
    expect(result.accounts[0]?.assets).toEqual([
      expect.objectContaining({
        balance: expect.objectContaining({ asset: 'ETH', amount: '1', kind: 'native' }),
        priceUsd: 2_000,
        valueUsd: 2_000,
      }),
      expect.objectContaining({
        balance: expect.objectContaining({ asset: 'TOK', amount: '1', tokenAddress: token }),
        priceUsd: 1,
        valueUsd: 1,
      }),
    ]);
    expect(priceService.getEvmPrices).toHaveBeenCalledWith('0x1', [token]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps unknown prices and failed wallet RPCs from producing false totals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'not available' },
    })));
    const priceService = {
      getEvmPrices: vi.fn(),
    };
    const result = await createService(priceService).aggregate([{
      address: wallet,
      chain: 'evm',
      chainId: '0x1',
      tokenAddresses: [],
    }]);

    expect(result).toMatchObject({
      complete: false,
      totalUsd: null,
      accounts: [{ available: false, assets: [], totalUsd: null }],
    });
    expect(priceService.getEvmPrices).not.toHaveBeenCalled();
  });

  it('returns balances with unknown prices when the pricing integration is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as { method: string; id: number };
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: body.method === 'eth_getBalance' ? '0x0' : null,
      });
    }));
    const result = await createService({
      getEvmPrices: vi.fn().mockRejectedValue(new Error('price service unavailable')),
    }).aggregate([{
      address: wallet,
      chain: 'evm',
      chainId: '0x1',
      tokenAddresses: [],
    }]);

    expect(result).toMatchObject({
      complete: false,
      totalUsd: null,
      accounts: [{
        available: true,
        assets: [{ balance: { amount: '0', asset: 'ETH' }, priceUsd: null, valueUsd: null }],
      }],
    });
  });
});
