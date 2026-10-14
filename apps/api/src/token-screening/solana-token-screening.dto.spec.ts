import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { SolanaTokenScreeningDto } from './solana-token-screening.dto.js';

describe('SolanaTokenScreeningDto', () => {
  it('accepts a syntactically valid Solana mint address', async () => {
    const dto = plainToInstance(SolanaTokenScreeningDto, {
      mint: 'So11111111111111111111111111111111111111112',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects malformed base58 values and wrong lengths', async () => {
    const dto = plainToInstance(SolanaTokenScreeningDto, { mint: '0Invalid' });
    await expect(validate(dto)).resolves.toHaveLength(1);
  });
});
