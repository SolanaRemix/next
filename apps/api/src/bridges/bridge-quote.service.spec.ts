import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BridgeQuoteService } from './bridge-quote.service.js';

const evmToken = '0x0000000000000000000000000000000000000001';
const evmWallet = '0x0000000000000000000000000000000000000002';
const solanaToken = 'So11111111111111111111111111111111111111112';
const solanaWallet = '11111111111111111111111111111111';
const request = {
  fromChainId: 1,
  toChainId: 1151111081099710,
  fromToken: evmToken,
  toToken: solanaToken,
  fromAmount: '1000000000000000000',
  fromAddress: evmWallet,
  toAddress: solanaWallet,
  slippageBps: 50,
};

function providerResponse() {
  return Response.json({
    tool: 'across',
    toolDetails: { name: 'Across' },
    action: {
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromAddress: evmWallet,
      toAddress: solanaWallet,
      fromToken: { address: evmToken, symbol: 'ETH' },
      toToken: { address: solanaToken, symbol: 'SOL' },
      fromAmount: request.fromAmount,
    },
    estimate: {
      toAmount: '2000000000',
      toAmountMin: '1990000000',
      estimatedExecutionDuration: 300,
      feeCosts: [{
        name: 'Bridge fee',
        amount: '100',
        amountUSD: '0.10',
        token: { symbol: 'USDC' },
      }],
      gasCosts: [{ amount: '21000', token: { symbol: 'ETH' } }],
    },
    transactionRequest: { to: '0xdeadbeef', data: '0xsecret-calldata' },
  });
}

describe('BridgeQuoteService', () => {
  const originalApiKey = process.env.LIFI_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.LIFI_API_KEY;
    else process.env.LIFI_API_KEY = originalApiKey;
  });

  it('returns a validated LI.FI cross-chain quote without executable transaction data', async () => {
    process.env.LIFI_API_KEY = 'server-only-test-key';
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      providerResponse(),
    );
    vi.stubGlobal('fetch', fetch);

    const result = await new BridgeQuoteService().quote(request);
    const [input, init] = fetch.mock.calls[0] ?? [];
    const url = new URL(String(input));

    expect(url.origin + url.pathname).toBe('https://li.quest/v1/quote');
    expect(url.searchParams.get('fromChain')).toBe(String(request.fromChainId));
    expect(url.searchParams.get('toChain')).toBe(String(request.toChainId));
    expect(url.searchParams.get('slippage')).toBe('0.005');
    expect(url.searchParams.get('allowDestinationCall')).toBe('false');
    expect((init?.headers as Record<string, string>)['x-lifi-api-key']).toBe('server-only-test-key');
    expect(result).toMatchObject({
      provider: 'LI.FI',
      fromAmount: request.fromAmount,
      toAmount: '2000000000',
      minimumToAmount: '1990000000',
      routeToolName: 'Across',
      estimatedDurationSeconds: 300,
      costs: [
        { kind: 'fee', name: 'Bridge fee', amount: '100', tokenSymbol: 'USDC', amountUsd: '0.10' },
        { kind: 'gas', amount: '21000', tokenSymbol: 'ETH' },
      ],
    });
    expect(result).not.toHaveProperty('transactionRequest');
    expect(JSON.stringify(result)).not.toContain('secret-calldata');
  });

  it('rejects same-chain requests before calling the external provider', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(new BridgeQuoteService().quote({
      ...request,
      toChainId: request.fromChainId,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects wallet or token addresses that do not match their chain', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(new BridgeQuoteService().quote({
      ...request,
      fromAddress: solanaWallet,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects provider responses that do not match the requested input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      tool: 'across',
      toolDetails: { name: 'Across' },
      action: {
        fromChainId: request.fromChainId,
        toChainId: request.toChainId,
        fromAddress: evmWallet,
        toAddress: solanaWallet,
        fromToken: { address: evmToken, symbol: 'ETH' },
        toToken: { address: solanaToken, symbol: 'SOL' },
        fromAmount: '1',
      },
      estimate: {
        toAmount: '2000000000',
        toAmountMin: '1990000000',
      },
    })));

    await expect(new BridgeQuoteService().quote(request))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
