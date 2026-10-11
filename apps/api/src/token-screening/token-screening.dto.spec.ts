import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { EvmTokenScreeningDto } from './token-screening.dto.js';

describe('EvmTokenScreeningDto', () => {
  it('accepts a supported chain ID and EVM token address', async () => {
    const dto = plainToInstance(EvmTokenScreeningDto, {
      chainId: '0x1',
      tokenAddress: '0x2222222222222222222222222222222222222222',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported networks and malformed token addresses', async () => {
    const dto = plainToInstance(EvmTokenScreeningDto, {
      chainId: '999',
      tokenAddress: 'not-an-address',
    });

    const errors = await validate(dto);
    expect(errors.map(({ property }) => property).sort()).toEqual(['chainId', 'tokenAddress']);
  });
});
