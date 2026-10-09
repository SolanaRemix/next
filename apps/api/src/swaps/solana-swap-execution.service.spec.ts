import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { SolanaSwapExecutionService } from './solana-swap-execution.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FinancialControlsService } from '../financial-controls/financial-controls.service.js';

const executionId = 'afe6024a-5cd2-48d4-b47c-69f0c73aa161';
const idempotencyKey = '9deddb44-b4b0-46b0-9fd6-5cde616fdba4';
const requestId = 'jupiter-order-1';
const taker = '11111111111111111111111111111111';
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const encodedTransaction = Buffer.from([1, ...new Array<number>(64).fill(1), 7]).toString('base64');

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
  const create = vi.fn(async (args: { data: { id: string } }) => ({ id: args.data.id }));
  const transaction = {
    $queryRaw: vi.fn(async () => [{ enabled: true }]),
    solanaSwapOrder: { create },
  };
  return {
    $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction)),
    transaction,
    solanaSwapOrder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('SolanaSwapExecutionService', () => {
  const prisma = createPrismaMock();
  const config = { get: vi.fn(() => 'jupiter-test-key') };
  const controls = { assertExecutionEnabled: vi.fn(async () => undefined) };
  const service = new SolanaSwapExecutionService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
    controls as unknown as FinancialControlsService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    controls.assertExecutionEnabled.mockResolvedValue(undefined);
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
    expect(prisma.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.transaction.solanaSwapOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: result.executionId,
        userId: 'user-1',
        idempotencyKey,
        taker,
      }),
    }));
  });

  it('does not persist an order when the execution control is disabled at admission', async () => {
    prisma.transaction.$queryRaw.mockResolvedValueOnce([]);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(providerOrder)));

    await expect(service.order('user-1', request)).rejects.toThrow(/execution is disabled/i);
    expect(prisma.transaction.solanaSwapOrder.create).not.toHaveBeenCalled();
  });

  it('blocks order creation while the global execution control is disabled', async () => {
    controls.assertExecutionEnabled.mockRejectedValueOnce(new Error('disabled'));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(service.order('user-1', request)).rejects.toThrow('disabled');
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.solanaSwapOrder.findUnique).not.toHaveBeenCalled();
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
    expect(prisma.transaction.solanaSwapOrder.create).not.toHaveBeenCalled();
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
    expect(prisma.solanaSwapOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        executionStatus: 'EXECUTING',
        transactionSignature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/),
        signedTransactionHash: createHash('sha256')
          .update(Buffer.from(encodedTransaction, 'base64'))
          .digest('hex'),
      }),
    }));
  });

  it('does not roll back a newer execution attempt when the global control is disabled', async () => {
    prisma.solanaSwapOrder.findFirst.mockResolvedValue({
      id: executionId,
      requestId,
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 30_000),
      executionStatus: 'ORDERED',
      executionKey: null,
      executionResult: null,
      updatedAt: new Date(),
    });
    controls.assertExecutionEnabled
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disabled'));
    prisma.solanaSwapOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(service.execute('user-1', {
      executionId,
      requestId,
      signedTransaction: encodedTransaction,
      idempotencyKey,
    })).rejects.toThrow('disabled');
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.solanaSwapOrder.updateMany).toHaveBeenCalledTimes(2);
    const claim = prisma.solanaSwapOrder.updateMany.mock.calls[0]?.[0];
    const rollback = prisma.solanaSwapOrder.updateMany.mock.calls[1]?.[0];
    const newerAttemptId = 'b46cd8b7-d54a-4620-867a-40d67da43c5d';
    expect(claim?.data.executionAttemptId).not.toBe(newerAttemptId);
    expect(rollback?.where).toEqual(expect.objectContaining({
      executionAttemptId: claim?.data.executionAttemptId,
    }));
    expect(rollback?.where.executionAttemptId).not.toBe(newerAttemptId);
    expect(prisma.solanaSwapOrder.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        executionStatus: 'ORDERED',
        executionKey: null,
        signedTransactionHash: null,
      }),
    }));
  });

  it('reconciles interrupted execution from the Solana RPC signature status', async () => {
    prisma.solanaSwapOrder.findFirst.mockResolvedValue({
      id: executionId,
      userId: 'user-1',
      executionStatus: 'EXECUTING',
      executionResult: null,
      transactionSignature: '1'.repeat(32),
    });
    prisma.solanaSwapOrder.updateMany.mockResolvedValue({ count: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      result: {
        value: [{ err: null, confirmationStatus: 'confirmed', confirmations: 1 }],
      },
    })));

    await expect(service.status('user-1', executionId)).resolves.toEqual({
      status: 'success',
      signature: '1'.repeat(32),
      error: null,
    });
    expect(prisma.solanaSwapOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ executionStatus: 'SUCCEEDED' }),
    }));
  });

  it('does not persist a failure from an unconfirmed fork', async () => {
    prisma.solanaSwapOrder.findFirst.mockResolvedValue({
      id: executionId,
      userId: 'user-1',
      executionStatus: 'EXECUTING',
      executionResult: null,
      transactionSignature: '1'.repeat(32),
    });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      result: {
        value: [{
          err: { InstructionError: [0, 'Custom'] },
          confirmationStatus: 'processed',
          confirmations: 1,
        }],
      },
    })));

    await expect(service.status('user-1', executionId)).resolves.toEqual({
      status: 'processing',
      signature: '1'.repeat(32),
      error: null,
    });
    expect(prisma.solanaSwapOrder.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a different signed transaction when retrying a claimed order', async () => {
    prisma.solanaSwapOrder.findFirst.mockResolvedValue({
      id: executionId,
      requestId,
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 30_000),
      executionStatus: 'EXECUTING',
      executionKey: idempotencyKey,
      executionResult: null,
      transactionSignature: null,
      signedTransactionHash: createHash('sha256')
        .update(Buffer.from(encodedTransaction, 'base64'))
        .digest('hex'),
      updatedAt: new Date(),
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(service.execute('user-1', {
      executionId,
      requestId,
      signedTransaction: Buffer.from([1, ...new Array<number>(64).fill(2), 7]).toString('base64'),
      idempotencyKey,
    })).rejects.toThrow(/original idempotency key and signed transaction/);
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.solanaSwapOrder.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a different signed transaction when replaying a completed order', async () => {
    prisma.solanaSwapOrder.findFirst.mockResolvedValue({
      id: executionId,
      requestId,
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 30_000),
      executionStatus: 'SUCCEEDED',
      executionKey: idempotencyKey,
      executionResult: {
        status: 'success',
        signature: '1'.repeat(32),
        error: null,
      },
      transactionSignature: '1'.repeat(32),
      signedTransactionHash: createHash('sha256')
        .update(Buffer.from(encodedTransaction, 'base64'))
        .digest('hex'),
      updatedAt: new Date(),
    });

    await expect(service.execute('user-1', {
      executionId,
      requestId,
      signedTransaction: Buffer.from([1, ...new Array<number>(64).fill(3), 7]).toString('base64'),
      idempotencyKey,
    })).rejects.toThrow(/original idempotency key and signed transaction/);
    expect(prisma.solanaSwapOrder.updateMany).not.toHaveBeenCalled();
  });
});
