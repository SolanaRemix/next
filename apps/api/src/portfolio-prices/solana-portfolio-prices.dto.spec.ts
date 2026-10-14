import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { SolanaPortfolioPricesDto } from './solana-portfolio-prices.dto.js';

describe('SolanaPortfolioPricesDto', () => {
  it('accepts mainnet beta and valid unique Solana mints', async () => {
    const request = Object.assign(new SolanaPortfolioPricesDto(), {
      chainId: 'mainnet-beta',
      tokenMints: ['So11111111111111111111111111111111111111112'],
    });
    await expect(validate(request)).resolves.toHaveLength(0);
  });

  it('rejects other clusters, malformed mints, duplicates, and oversized lists', async () => {
    const invalidRequests = [
      { chainId: 'devnet', tokenMints: [] },
      { chainId: 'mainnet-beta', tokenMints: ['invalid'] },
      {
        chainId: 'mainnet-beta',
        tokenMints: [
          'So11111111111111111111111111111111111111112',
          'So11111111111111111111111111111111111111112',
        ],
      },
      { chainId: 'mainnet-beta', tokenMints: Array(51).fill('So11111111111111111111111111111111111111112') },
    ];
    for (const input of invalidRequests) {
      const request = Object.assign(new SolanaPortfolioPricesDto(), input);
      await expect(validate(request)).resolves.not.toHaveLength(0);
    }
  });
});
