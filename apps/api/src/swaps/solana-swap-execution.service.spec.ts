import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { SolanaSwapExecutionService } from './solana-swap-execution.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const executionId = 'afe6024a-5cd2-48d4-b47c-69f0c73aa161';
const idempotencyKey = '9deddb44-b4b0-46b0-9fd6-5cde616fdba4';
const requestId = 'jupiter-order-1';
const taker = '11111111111111111111111111111111';
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const encodedTransaction = Buffer.from([1]).toString('base64');

const request = {
  inputMint,
  outputMint,
  amount: '1000000',
  taker,
  idempotencyKey,
};

const providerOrder = {
  requestId,
  transaction: encodedTransaction,
  inputMint,
  outputMint,
  inAmount: request.amount,
  outAmount: '2500000',
  otherAmountThreshold: '2475000',
  slippageBps: 100,
  prioritizationFeeLamports: 12000,
  router: 'metis',
  taker,
};

function createPrismaMock() {
  return {
    solanaSwapOrder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(async (args: { data: { id: string } }) => ({ id: args.data.id })),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('SolanaSwapExecutionService', () => {
  const prisma = createPrismaMock();
  const config = { get: vi.fn(() => 'jupiter-test-key') };
  const service = new SolanaSwapExecutionService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.solanaSwapOrder.findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests Jupiter RTSE and automatic landing fees, then persists the wallet order', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(providerOrder));
    vi.stubGlobal('fetch', fetch);

    const result = await service.order('user-1', request);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    const options = fetch.mock.calls[0]?.[1] as RequestInit;

    expect(url.pathname).toBe('/swap/v2/order');
    expect(url.searchParams.get('taker')).toBe(taker);
    expect(url.searchParams.has('slippageBps')).toBe(false);
    expect(url.searchParams.has('priorityFeeLamports')).toBe(false);
    expect(options.headers).toMatchObject({ 'x-api-key': 'jupiter-test-key' });
    expect(result).toMatchObject({
      requestId,
      slippageBps: 100,
      prioritizationFeeLamports: 12000,
      minimumOutputAmount: '2475000',
    });
    expect(result.executionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(prisma.solanaSwapOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: result.executionId,
        userId: 'user-1',
        idempotencyKey,
        taker,
      }),
    }));
  });

  it('replays an existing unexpired idempotent order without contacting Jupiter', async () => {
    prisma.solanaSwapOrder.findUnique.mockResolvedValue({
      id: executionId,
      taker,
      inputMint,
      outputMint,
      inputAmount: request.amount,
      expiresAt: new Date(Date.now() + 30_000),
      orderPayload: {
        executionId,
        requestId,
        transaction: encodedTransaction,
        inputMint,
        outputMint,
        inAmount: request.amount,
        outAmount: '2500000',
        minimumOutputAmount: '2475000',
        slippageBps: 100,
        prioritizationFeeLamports: 12000,
        router: 'metis',
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      } as Prisma.JsonObject,
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(service.order('user-1', request)).resolves.toMatchObject({ executionId, requestId });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an order response for a different taker or token pair', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ...providerOrder,
      taker: outputMint,
    })));

    await expect(service.order('user-1', request)).rejects.toThrow(/invalid or non-executable/);
    expect(prisma.solanaSwapOrder.create).not.toHaveBeenCalled();
  });

  it('submits a signed order once and stores Jupiter execution status', async () => {
    prisma.solanaSwapOrder.findFirst.mockResolvedValue({
      id: executionId,
      requestId,
      userId: 'user-1',
      taker,
      expiresAt: new Date(Date.now() + 30_000),
      executionStatus: 'ORDERED',
      executionKey: null,
      executionResult: null,
      updatedAt: new Date(),
    });
    prisma.solanaSwapOrder.updateMany.mockResolvedValue({ count: 1 });
    prisma.solanaSwapOrder.update.mockResolvedValue({});
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
      status: 'Success',
      signature: '1'.repeat(32),
    }));
    vi.stubGlobal('fetch', fetch);

    const result = await service.execute('user-1', {
      executionId,
      requestId,
      signedTransaction: encodedTransaction,
      idempotencyKey,
    });
    const options = fetch.mock.calls[0]?.[1] as RequestInit;

    expect(fetch).toHaveBeenCalledOnce();
    expect(options.body).toBe(JSON.stringify({
      signedTransaction: encodedTransaction,
      requestId,
    }));
    expect(result).toEqual({ status: 'success', signature: '1'.repeat(32), error: null });
    expect(prisma.solanaSwapOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ executionStatus: 'SUCCEEDED' }),
    }));
  });
});
