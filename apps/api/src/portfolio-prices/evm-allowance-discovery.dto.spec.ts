import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EvmAllowanceDiscoveryDto } from './evm-allowance-discovery.dto.js';

const request = {
  chainId: '0x1',
  owner: '0x1111111111111111111111111111111111111111',
  tokenAddresses: ['0x2222222222222222222222222222222222222222'],
};

describe('EvmAllowanceDiscoveryDto', () => {
  it('accepts supported networks, valid owner, and tracked token contracts', async () => {
    await expect(validate(plainToInstance(EvmAllowanceDiscoveryDto, request))).resolves.toHaveLength(0);
  });

  it('rejects unsupported networks, malformed addresses, duplicate or excessive token lists', async () => {
    for (const value of [
      { ...request, chainId: '0x999' },
      { ...request, owner: 'invalid' },
      { ...request, tokenAddresses: [request.tokenAddresses[0], request.tokenAddresses[0]] },
      { ...request, tokenAddresses: Array(51).fill(request.tokenAddresses[0]) },
    ]) {
      await expect(validate(plainToInstance(EvmAllowanceDiscoveryDto, value))).resolves.not.toHaveLength(0);
    }
  });
});
