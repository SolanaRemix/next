import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrossChainPortfolioDto } from './cross-chain-portfolio.dto.js';

const evmAccount = {
  address: '0x1111111111111111111111111111111111111111',
  chain: 'evm',
  chainId: '0x1',
  tokenAddresses: ['0x2222222222222222222222222222222222222222'],
};

describe('CrossChainPortfolioDto', () => {
  it('accepts multiple supported EVM and Solana public wallet accounts', async () => {
    const dto = plainToInstance(CrossChainPortfolioDto, {
      accounts: [
        evmAccount,
        {
          address: '11111111111111111111111111111111',
          chain: 'solana',
          chainId: 'mainnet-beta',
          tokenAddresses: [],
        },
      ],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects excessive wallets, unsupported networks, malformed addresses, and duplicates', async () => {
    for (const accounts of [
      Array.from({ length: 9 }, (_, index) => ({
        ...evmAccount,
        address: `0x${String(index).padStart(40, '0')}`,
      })),
      [{ ...evmAccount, chainId: '0x999' }],
      [{ ...evmAccount, address: 'not-an-address' }],
      [evmAccount, evmAccount],
      [{ ...evmAccount, tokenAddresses: Array(51).fill(evmAccount.tokenAddresses[0]) }],
    ]) {
      const dto = plainToInstance(CrossChainPortfolioDto, { accounts });
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    }
  });
});
