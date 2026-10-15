import { describe, expect, it } from 'vitest';
import { api, createApiClient, schemas } from './generated.js';

describe('contract-generated API client', () => {
  it('validates request schemas from the OpenAPI contract', () => {
    expect(schemas.Credentials.safeParse({
      email: 'operator@example.com',
      password: 'a-secure-password',
    }).success).toBe(true);
    expect(schemas.Credentials.safeParse({
      email: 'not-an-email',
      password: 'short',
    }).success).toBe(false);
    expect(schemas.SwapQuoteRequest.safeParse({
      chainId: 1,
      sellToken: 'invalid',
      buyToken: '0x0000000000000000000000000000000000000001',
      sellAmount: '100',
      sellDecimals: 18,
      buyDecimals: 18,
      maxSlippageBps: 100,
    }).success).toBe(false);
  });

  it('exposes typed endpoint clients and configurable base URLs', () => {
    expect(typeof api.getBridgeQuote).toBe('function');
    expect(typeof api.getEvmSwapStatus).toBe('function');
    expect(createApiClient('https://api.example.test/api')).toBeDefined();
  });
});
