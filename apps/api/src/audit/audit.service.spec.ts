import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function createService() {
  const prisma = {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    service: new AuditService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('AuditService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records successful results with the actor and minimal metadata', async () => {
    const { service, prisma } = createService();

    const result = await service.track(
      'user-id',
      'swap.quote.requested',
      { chainId: 1 },
      async () => ({ routes: ['0x', 'paraswap'] }),
      (quote) => ({ routeCount: quote.routes.length }),
    );

    expect(result.routes).toHaveLength(2);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'user-id',
        action: 'swap.quote.requested',
        metadata: { chainId: 1, routeCount: 2, outcome: 'success' },
      },
    });
  });

  it('audits rejected operations without persisting exception messages', async () => {
    const { service, prisma } = createService();
    const failure = new BadRequestException('sensitive provider detail');

    await expect(service.track(
      'user-id',
      'perpetual.risk_check.requested',
      { side: 'long' },
      () => Promise.reject(failure),
      () => ({}),
    )).rejects.toBe(failure);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'user-id',
        action: 'perpetual.risk_check.requested',
        metadata: { side: 'long', outcome: 'failure', failureStatus: 400 },
      },
    });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      'sensitive provider detail',
    );
  });

  it('does not return a result if its audit record cannot be persisted', async () => {
    const { service, prisma } = createService();
    prisma.auditLog.create.mockRejectedValue(new Error('database unavailable'));

    await expect(service.track(
      'user-id',
      'swap.quote.requested',
      { chainId: 1 },
      async () => 'quote',
      () => ({}),
    )).rejects.toThrow('database unavailable');
  });
});
