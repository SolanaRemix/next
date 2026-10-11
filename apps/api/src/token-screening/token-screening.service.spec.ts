import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { TokenScreeningService } from './token-screening.service.js';

const tokenAddress = '0x2222222222222222222222222222222222222222';
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
  const fetch = vi.fn(async () => Response.json(body, { status }));
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
});
