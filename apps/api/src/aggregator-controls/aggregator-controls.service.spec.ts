import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AggregatorControlsService } from './aggregator-controls.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('AggregatorControlsService', () => {
  it('fails closed when the persisted control row is missing', async () => {
    const prisma = {
      evmQuoteProviderControl: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new AggregatorControlsService(prisma as unknown as PrismaService);

    await expect(service.getControl()).resolves.toEqual({
      enabledProviders: [],
      updatedAt: null,
      updatedBy: null,
    });
    await expect(service.getEnabledProviders()).resolves.toEqual([]);
  });

  it('updates providers and writes audit data transactionally', async () => {
    const updatedAt = new Date('2026-10-14T11:00:00.000Z');
    const upsert = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue({ enabledProviders: ['0x', '1inch', 'paraswap'] });
    const update = vi.fn().mockResolvedValue({
      enabledProviders: ['1inch', 'paraswap'],
      updatedAt,
      updatedBy: 'super-admin',
    });
    const auditCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      evmQuoteProviderControl: { upsert, findUnique, update },
      auditLog: { create: auditCreate },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'evm_quote_providers' }]),
    };
    const prisma = {
      $transaction: vi.fn(async (action: (client: typeof transaction) => Promise<unknown>) => action(transaction)),
    };
    const service = new AggregatorControlsService(prisma as unknown as PrismaService);

    await expect(service.updateControl('super-admin', ['1inch', 'paraswap'], 'degraded quote source'))
      .resolves.toEqual({
        enabledProviders: ['1inch', 'paraswap'],
        updatedAt: updatedAt.toISOString(),
        updatedBy: 'super-admin',
      });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evm_quote_providers' },
      data: { enabledProviders: ['1inch', 'paraswap'], updatedBy: 'super-admin' },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: 'super-admin',
        action: 'admin.evm_quote_providers.changed',
        metadata: {
          previousEnabledProviders: ['0x', '1inch', 'paraswap'],
          enabledProviders: ['1inch', 'paraswap'],
          reason: 'degraded quote source',
        },
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('rejects unknown or duplicate provider values', async () => {
    const service = new AggregatorControlsService({} as PrismaService);
    await expect(service.updateControl('admin', ['unknown'], 'test'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateControl('admin', ['0x', '0x'], 'test'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
