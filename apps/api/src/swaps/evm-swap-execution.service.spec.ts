import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EvmSwapExecutionService } from './evm-swap-execution.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FinancialControlsService } from '../financial-controls/financial-controls.service.js';

const executionId = 'afe6024a-5cd2-48d4-b47c-69f0c73aa161';
const idempotencyKey = '9deddb44-b4b0-46b0-9fd6-5cde616fdba4';
const taker = '0x1111111111111111111111111111111111111111';
const sellToken = '0x2222222222222222222222222222222222222222';
const buyToken = '0x3333333333333333333333333333333333333333';
const spender = '0x4444444444444444444444444444444444444444';
const txTo = '0x5555555555555555555555555555555555555555';
const txData = '0x12345678';
const transactionHash = `0x${'a'.repeat(64)}`;

const request = {
  chainId: 1,
  sellToken,
  buyToken,
  sellAmount: '1000000',
  sellDecimals: 6,
  buyDecimals: 18,
  maxSlippageBps: 100,
  taker,
  idempotencyKey,
};

const orderRow = {
  id: executionId,
  userId: 'user-1',
  idempotencyKey,
  chainId: 1,
  taker,
  sellToken,
  buyToken,
  sellAmount: '1000000',
  buyAmount: '2000000',
  minimumBuyAmount: '1980000',
  allowanceSpender: spender,
  transactionTo: txTo,
  transactionData: txData,
  transactionValue: '0',
  expiresAt: new Date(Date.now() + 60_000),
  orderPayload: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
  executionStatus: 'ORDERED',
  transactionHash: null,
  executionResult: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createPrismaMock() {
  return {
    evmSwapOrder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('EvmSwapExecutionService', () => {
  const prisma = createPrismaMock();
  const config = {
    get: vi.fn((key: string) =>
      key === 'ZEROX_API_KEY' ? '0x-test-key' : key === 'EVM_RPC_URL_1' ? 'https://rpc.example.com' : undefined,
    ),
  };
  const controls = { assertExecutionEnabled: vi.fn(async () => undefined) };
  const service = new EvmSwapExecutionService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
    controls as unknown as FinancialControlsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    controls.assertExecutionEnabled.mockResolvedValue(undefined);
    prisma.evmSwapOrder.findUnique.mockResolvedValue(null);
    prisma.evmSwapOrder.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests a 0x allowance-holder quote and persists a wallet-bound idempotent order', async () => {
    prisma.evmSwapOrder.create.mockResolvedValue(orderRow);
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe('api.0x.org');
      expect(url.pathname).toBe('/swap/allowance-holder/quote');
      expect(url.searchParams.get('chainId')).toBe('1');
      expect(url.searchParams.get('taker')).toBe(taker);
      expect(init?.headers).toMatchObject({ '0x-api-key': '0x-test-key' });
      return Response.json({
        sellToken,
        buyToken,
        sellAmount: request.sellAmount,
        buyAmount: '2000000',
        issues: { allowance: { spender } },
        transaction: { to: txTo, data: txData, value: '0' },
      });
    });
    vi.stubGlobal('fetch', fetch);

    const result = await service.order('user-1', request);

    expect(result).toMatchObject({
      executionId,
      minimumBuyAmount: '1980000',
      allowanceSpender: spender,
      transaction: { to: txTo, data: txData, value: '0' },
    });
    expect(prisma.evmSwapOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        idempotencyKey,
        chainId: 1,
        taker,
        minimumBuyAmount: '1980000',
      }),
    }));
  });

  it('fails closed when global financial execution is disabled', async () => {
    controls.assertExecutionEnabled.mockRejectedValueOnce(new Error('disabled'));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(service.order('user-1', request)).rejects.toThrow('disabled');
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.evmSwapOrder.create).not.toHaveBeenCalled();
  });

  it('rejects an aggregator transaction that does not match the requested assets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      sellToken,
      buyToken: sellToken,
      sellAmount: request.sellAmount,
      buyAmount: '2000000',
      issues: { allowance: { spender } },
      transaction: { to: txTo, data: txData, value: '0' },
    })));

    await expect(service.order('user-1', request)).rejects.toThrow(/does not match/);
    expect(prisma.evmSwapOrder.create).not.toHaveBeenCalled();
  });

  it('verifies the submitted transaction and waits for two blocks before success', async () => {
    prisma.evmSwapOrder.findFirst
      .mockResolvedValueOnce(orderRow)
      .mockResolvedValueOnce({ ...orderRow, executionStatus: 'SUBMITTED', transactionHash });
    prisma.evmSwapOrder.updateMany.mockResolvedValue({ count: 1 });
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'eth_chainId') return Response.json({ result: '0x1' });
      if (body.method === 'eth_getTransactionByHash') {
        return Response.json({ result: {
          from: taker,
          to: txTo,
          input: txData,
          value: '0x0',
        } });
      }
      if (body.method === 'eth_getTransactionReceipt') {
        return Response.json({ result: {
          status: '0x1',
          transactionHash,
          blockNumber: '0x10',
        } });
      }
      return Response.json({ result: '0x11' });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(service.execute('user-1', {
      executionId,
      transactionHash,
      idempotencyKey,
    })).resolves.toEqual({ status: 'success', transactionHash, error: null });
    expect(fetch.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)).method,
    )).toEqual([
      'eth_chainId',
      'eth_getTransactionByHash',
      'eth_getTransactionReceipt',
      'eth_blockNumber',
    ]);
    expect(prisma.evmSwapOrder.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a transaction whose calldata differs from the persisted 0x order', async () => {
    prisma.evmSwapOrder.findFirst.mockResolvedValueOnce(orderRow);
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      return Response.json({ result: body.method === 'eth_chainId'
        ? '0x1'
        : { from: taker, to: txTo, input: '0x87654321', value: '0x0' } });
    }));

    await expect(service.execute('user-1', {
      executionId,
      transactionHash,
      idempotencyKey,
    })).rejects.toThrow(/does not match/);
    expect(prisma.evmSwapOrder.updateMany).not.toHaveBeenCalled();
  });
});
