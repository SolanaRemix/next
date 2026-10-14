import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { EvmPortfolioPricesDto } from './portfolio-prices.dto.js';

describe('EvmPortfolioPricesDto', () => {
  it('accepts supported networks and unique valid EVM contracts', async () => {
    const request = Object.assign(new EvmPortfolioPricesDto(), {
      chainId: '0x1',
      tokenAddresses: ['0x2222222222222222222222222222222222222222'],
    });
    await expect(validate(request)).resolves.toHaveLength(0);
  });

  it('rejects unsupported networks, duplicate addresses, invalid addresses, and oversized batches', async () => {
    const invalidRequests = [
      { chainId: '0x999', tokenAddresses: [] },
      {
        chainId: '0x1',
        tokenAddresses: [
          '0xAb22222222222222222222222222222222222222',
          '0xab22222222222222222222222222222222222222',
        ],
      },
      { chainId: '0x1', tokenAddresses: ['invalid'] },
      { chainId: '0x1', tokenAddresses: Array(51).fill('0x2222222222222222222222222222222222222222') },
    ];
    for (const input of invalidRequests) {
      const request = Object.assign(new EvmPortfolioPricesDto(), input);
      await expect(validate(request)).resolves.not.toHaveLength(0);
    }
  });
});
