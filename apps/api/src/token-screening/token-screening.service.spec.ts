import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { TokenScreeningService } from './token-screening.service.js';
import type { RedisThrottlerStorage } from '../throttling/redis-throttler.storage.js';

const tokenAddress = '0x2222222222222222222222222222222222222222';
const solanaMint = 'So11111111111111111111111111111111111111112';
const baselineSignals = {
  is_honeypot: '0',
  is_open_source: '1',
  is_proxy: '0',
  is_mintable: '0',
  can_take_back_ownership: '0',
  owner_change_balance: '0',
  hidden_owner: '0',
  selfdestruct: '0',
  external_call: '0',
  is_blacklisted: '0',
  transfer_pausable: '0',
  slippage_modifiable: '0',
  buy_tax: '0',
  sell_tax: '0',
};

function stubProvider(body: unknown, status = 200) {
  const fetch = vi.fn(async (
    _input: string | URL | Request,
    _init?: RequestInit,
  ) => Response.json(body, { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('TokenScreeningService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes supported chain IDs and reports a low assessment from complete provider data', async () => {
    const fetch = stubProvider({
      code: 1,
      message: 'OK',
      result: { [tokenAddress]: baselineSignals },
    });

    const response = await new TokenScreeningService().screenEvmToken('0x1', tokenAddress);

    expect(response).toMatchObject({
      chainId: '1',
      tokenAddress,
      source: 'GoPlus',
      riskScore: 0,
      riskLevel: 'low',
      observedSignals: 14,
      totalSignals: 14,
      signals: {
        honeypot: false,
        openSource: true,
        buyTaxPercent: 0,
        sellTaxPercent: 0,
      },
      indicators: [],
    });
    expect(response.disclaimer).toMatch(/not a safety guarantee/);
    const [input, init] = fetch.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe('/api/v1/token_security/1');
    expect(url.searchParams.get('contract_addresses')).toBe(tokenAddress);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('elevates malicious capabilities and reports non-zero taxes', async () => {
    const token = {
      ...baselineSignals,
      is_honeypot: '1',
      is_blacklisted: '1',
      buy_tax: '12',
      sell_tax: '6',
    };
    stubProvider({ code: '1', result: { [tokenAddress.toUpperCase()]: token } });

    const response = await new TokenScreeningService().screenEvmToken('8453', tokenAddress);

    expect(response).toMatchObject({
      chainId: '8453',
      riskScore: 100,
      riskLevel: 'critical',
      signals: { honeypot: true, blacklisted: true, buyTaxPercent: 12, sellTaxPercent: 6 },
    });
    expect(response.indicators).toContain('Provider detected honeypot behavior');
    expect(response.indicators).toContain('Buy tax exceeds 10%');
    expect(response.indicators).toContain('Sell tax exceeds 5%');
  });

  it('keeps risk unknown when the provider returns missing or incomplete signals', async () => {
    stubProvider({ code: 1, result: { [tokenAddress]: { is_honeypot: '0', is_open_source: '1' } } });

    const response = await new TokenScreeningService().screenEvmToken('1', tokenAddress);

    expect(response).toMatchObject({
      riskScore: null,
      riskLevel: 'unknown',
      observedSignals: 2,
      signals: { honeypot: false, openSource: true, mintable: null },
    });
  });

  it('returns unknown when the requested address is absent from a successful provider response', async () => {
    stubProvider({ code: 1, result: {} });

    const response = await new TokenScreeningService().screenEvmToken('1', tokenAddress);

    expect(response).toMatchObject({
      riskScore: null,
      riskLevel: 'unknown',
      observedSignals: 0,
      signals: { honeypot: null, buyTaxPercent: null },
    });
  });

  it('rejects unsupported networks and malformed addresses before contacting the provider', async () => {
    const fetch = stubProvider({ code: 1, result: {} });
    const service = new TokenScreeningService();

    await expect(service.screenEvmToken('999', tokenAddress))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.screenEvmToken('1', 'not-an-address'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on provider HTTP, transport, and malformed-payload failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 429 })));
    await expect(new TokenScreeningService().screenEvmToken('1', tokenAddress))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private transport details'); }));
    await expect(new TokenScreeningService().screenEvmToken('1', tokenAddress))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    stubProvider({ code: 0, message: 'internal provider details', result: {} });
    await expect(new TokenScreeningService().screenEvmToken('1', tokenAddress))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('treats unrecognized values and out-of-range taxes as unknown instead of safe', async () => {
    stubProvider({
      code: 1,
      result: {
        [tokenAddress]: {
          ...baselineSignals,
          is_honeypot: 'unknown',
          buy_tax: '101',
          sell_tax: '-1',
        },
      },
    });

    const response = await new TokenScreeningService().screenEvmToken('1', tokenAddress);

    expect(response.riskLevel).toBe('unknown');
    expect(response.riskScore).toBeNull();
    expect(response.signals.honeypot).toBeNull();
    expect(response.signals.buyTaxPercent).toBeNull();
    expect(response.signals.sellTaxPercent).toBeNull();
  });

  it('screens Solana mints with beta endpoint and derives risk from extension authorities', async () => {
    const providerSignals = {
      mintable: { status: '0' },
      freezable: { status: '0' },
      closable: { status: '0' },
      balance_mutable_authority: { status: '0' },
      metadata_mutable: { status: '0' },
      transfer_fee: { current_fee_rate: { fee_rate: '0' } },
      transfer_fee_upgradable: { status: '0' },
      transfer_hook: [],
      transfer_hook_upgradable: { status: '0' },
      default_account_state: '1',
      default_account_state_upgradable: { status: '0' },
      none_transferable: '0',
      trusted_token: 1,
    };
    const fetch = stubProvider({
      code: 1,
      message: 'OK',
      result: { [solanaMint]: providerSignals },
    });

    const response = await new TokenScreeningService().screenSolanaToken(solanaMint);

    expect(response).toMatchObject({
      network: 'solana-mainnet',
      tokenAddress: solanaMint,
      source: 'GoPlus Solana beta',
      riskScore: 0,
      riskLevel: 'low',
      observedSignals: 14,
      totalSignals: 14,
      signals: {
        mintable: false,
        freezable: false,
        transferFeeEnabled: false,
        transferHookPresent: false,
        defaultAccountFrozen: false,
        trustedToken: true,
      },
    });
    expect(response.disclaimer).toMatch(/beta/i);
    const [input] = fetch.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe('/api/v1/solana/token_security');
    expect(url.searchParams.get('contract_addresses')).toBe(solanaMint);
  });

  it('caches validated EVM screening results for ten seconds with a hashed, normalized key', async () => {
    const entries = new Map<string, string>();
    const getTokenScreeningCache = vi.fn(async (key: string) => entries.get(key) ?? null);
    const setTokenScreeningCache = vi.fn(async (key: string, value: string, _ttlMs: number) => {
      entries.set(key, value);
    });
    const cache = {
      getTokenScreeningCache,
      setTokenScreeningCache,
    } as unknown as RedisThrottlerStorage;
    const service = new TokenScreeningService(cache);
    const fetch = stubProvider({ code: 1, result: { [tokenAddress]: baselineSignals } });

    const first = await service.screenEvmToken('1', tokenAddress);
    const second = await service.screenEvmToken('0x1', `0x${tokenAddress.slice(2).toUpperCase()}`);

    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledOnce();
    expect(setTokenScreeningCache).toHaveBeenCalledOnce();
    const key = getTokenScreeningCache.mock.calls[0]?.[0];
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(tokenAddress);
    expect(key).toBe(getTokenScreeningCache.mock.calls[1]?.[0]);
    expect(setTokenScreeningCache.mock.calls[0]?.[2]).toBe(10_000);
  });

  it('ignores inconsistent cached screening data and falls back to the provider', async () => {
    const inconsistent = {
      chainId: '1',
      tokenAddress,
      source: 'GoPlus',
      riskScore: 100,
      riskLevel: 'low',
      observedSignals: 14,
      totalSignals: 14,
      signals: {
        honeypot: false,
        openSource: true,
        proxy: false,
        mintable: false,
        ownershipRecoverable: false,
        ownerCanChangeBalance: false,
        hiddenOwner: false,
        selfDestruct: false,
        externalCall: false,
        blacklisted: false,
        transferPausable: false,
        slippageModifiable: false,
        buyTaxPercent: 0,
        sellTaxPercent: 0,
      },
      indicators: [],
      asOf: new Date().toISOString(),
      disclaimer: 'Risk indicators are provider-reported heuristics, may be incomplete or inaccurate, and are not a safety guarantee or financial advice.',
    };
    const getTokenScreeningCache = vi.fn().mockResolvedValue(JSON.stringify(inconsistent));
    const setTokenScreeningCache = vi.fn().mockResolvedValue(undefined);
    const service = new TokenScreeningService({
      getTokenScreeningCache,
      setTokenScreeningCache,
    } as unknown as RedisThrottlerStorage);
    const fetch = stubProvider({ code: 1, result: { [tokenAddress]: baselineSignals } });

    const response = await service.screenEvmToken('1', tokenAddress);

    expect(fetch).toHaveBeenCalledOnce();
    expect(response.riskLevel).toBe('low');
    expect(setTokenScreeningCache).toHaveBeenCalledOnce();
  });

  it('continues with GoPlus when the optional Redis screening cache fails', async () => {
    const service = new TokenScreeningService({
      getTokenScreeningCache: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      setTokenScreeningCache: vi.fn().mockRejectedValue(new Error('redis unavailable')),
    } as unknown as RedisThrottlerStorage);
    const fetch = stubProvider({ code: 1, result: { [tokenAddress]: baselineSignals } });

    const response = await service.screenEvmToken('1', tokenAddress);

    expect(fetch).toHaveBeenCalledOnce();
    expect(response.riskLevel).toBe('low');
  });

  it('keeps Solana screening cache entries isolated from EVM and other mints', async () => {
    const keys: string[] = [];
    const cache = {
      getTokenScreeningCache: vi.fn(async (key: string) => {
        keys.push(key);
        return null;
      }),
      setTokenScreeningCache: vi.fn().mockResolvedValue(undefined),
    } as unknown as RedisThrottlerStorage;
    const service = new TokenScreeningService(cache);
    const providerSignals = {
      mintable: { status: '0' },
      freezable: { status: '0' },
      closable: { status: '0' },
      balance_mutable_authority: { status: '0' },
      metadata_mutable: { status: '0' },
      transfer_fee: { current_fee_rate: { fee_rate: '0' } },
      transfer_fee_upgradable: { status: '0' },
      transfer_hook: [],
      transfer_hook_upgradable: { status: '0' },
      default_account_state: '1',
      default_account_state_upgradable: { status: '0' },
      none_transferable: '0',
      trusted_token: 1,
    };
    stubProvider({ code: 1, result: { [solanaMint]: providerSignals } });

    await service.screenSolanaToken(solanaMint);
    await service.screenSolanaToken('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(keys[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).not.toContain(solanaMint);
  });

  it('flags dangerous Solana token capabilities and non-transferable tokens as critical', async () => {
    const providerSignals = {
      mintable: { status: '1' },
      freezable: { status: '1' },
      closable: { status: '0' },
      balance_mutable_authority: { status: '0' },
      metadata_mutable: { status: '0' },
      transfer_fee: { current_fee_rate: { fee_rate: '0.02' } },
      transfer_fee_upgradable: { status: '1' },
      transfer_hook: [{ address: 'Hook1111111111111111111111111111111111111', malicious_address: 1 }],
      transfer_hook_upgradable: { status: '1' },
      default_account_state: '2',
      default_account_state_upgradable: { status: '1' },
      none_transferable: '1',
      trusted_token: 0,
    };
    stubProvider({ code: 1, result: { [solanaMint]: providerSignals } });

    const response = await new TokenScreeningService().screenSolanaToken(solanaMint);

    expect(response).toMatchObject({
      riskScore: 100,
      riskLevel: 'critical',
      signals: {
        mintable: true,
        freezable: true,
        transferFeeEnabled: true,
        transferHookPresent: true,
        maliciousTransferHook: true,
        defaultAccountFrozen: true,
        nonTransferable: true,
      },
    });
    expect(response.indicators).toContain('Provider flagged a transfer hook as malicious');
    expect(response.indicators).toContain('Token is non-transferable');
    expect(response.indicators).toContain('Token is not labeled trusted by the provider');
  });

  it('leaves Solana screening unknown when beta-provider signals are incomplete', async () => {
    stubProvider({ code: 1, result: { [solanaMint]: { mintable: { status: '0' } } } });

    const response = await new TokenScreeningService().screenSolanaToken(solanaMint);

    expect(response).toMatchObject({
      riskScore: null,
      riskLevel: 'unknown',
      observedSignals: 1,
      totalSignals: 14,
      signals: { mintable: false, freezable: null },
    });
  });

  it('rejects invalid Solana mints and fails closed on provider errors', async () => {
    const fetch = stubProvider({ code: 1, result: {} });
    await expect(new TokenScreeningService().screenSolanaToken('not-a-mint'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 0 }, { status: 200 })));
    await expect(new TokenScreeningService().screenSolanaToken(solanaMint))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
