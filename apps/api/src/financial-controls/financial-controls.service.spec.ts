import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { FinancialControlsService } from './financial-controls.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('FinancialControlsService', () => {
  it('fails closed when the global control row is missing', async () => {
    const prisma = {
      financialOperationsControl: { findUnique: vi.fn(async () => null) },
    };
    const service = new FinancialControlsService(prisma as unknown as PrismaService);

    await expect(service.getExecutionControl()).resolves.toEqual({
      enabled: false,
      updatedAt: null,
      updatedBy: null,
    });
    await expect(service.assertExecutionEnabled()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('records control changes and their audit record in one database transaction', async () => {
    const previous = { enabled: false };
    const updatedAt = new Date('2026-10-09T00:00:00.000Z');
    const findUnique = vi.fn(async () => previous);
    const upsert = vi.fn(async () => ({
      enabled: true,
      updatedAt,
      updatedBy: 'admin-id',
    }));
    const createAudit = vi.fn(async () => ({}));
    const transaction = {
      financialOperationsControl: { findUnique, upsert },
      auditLog: { create: createAudit },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction)),
    };
    const service = new FinancialControlsService(prisma as unknown as PrismaService);

    await expect(service.setExecutionControl('admin-id', true, 'release approved'))
      .resolves.toEqual({
        enabled: true,
        updatedAt: updatedAt.toISOString(),
        updatedBy: 'admin-id',
      });
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'global_execution' },
      create: { id: 'global_execution', enabled: true, updatedBy: 'admin-id' },
      update: { enabled: true, updatedBy: 'admin-id' },
    });
    expect(createAudit).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-id',
        action: 'admin.financial_execution_control.changed',
        metadata: {
          previousEnabled: false,
          enabled: true,
          reason: 'release approved',
        },
      },
    });
  });
});
