import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function createService() {
  const prisma = {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn(),
    },
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

  it('returns bounded audit pages with actor identity and stable newest-first cursors', async () => {
    const { service, prisma } = createService();
    const createdAt = new Date('2026-10-09T12:00:00.000Z');
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        actorId: 'actor-1',
        actor: { email: 'admin@example.com' },
        action: 'admin.user.role_changed',
        metadata: { previousRole: 'Guest', newRole: 'Trader' },
        createdAt,
      },
      {
        id: 'audit-2',
        actorId: null,
        actor: null,
        action: 'auth.login.failed',
        metadata: { outcome: 'failure' },
        createdAt,
      },
      {
        id: 'audit-3',
        actorId: 'actor-2',
        actor: { email: 'other@example.com' },
        action: 'auth.logout',
        metadata: {},
        createdAt,
      },
    ]);

    await expect(service.list({
      limit: 2,
      cursor: 'cursor-id',
      actorId: 'actor-1',
      action: 'admin.user.role_changed',
    })).resolves.toEqual({
      entries: [
        {
          id: 'audit-1',
          actorId: 'actor-1',
          actorEmail: 'admin@example.com',
          action: 'admin.user.role_changed',
          metadata: { previousRole: 'Guest', newRole: 'Trader' },
          createdAt: createdAt.toISOString(),
        },
        {
          id: 'audit-2',
          actorId: null,
          actorEmail: null,
          action: 'auth.login.failed',
          metadata: { outcome: 'failure' },
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: 'audit-2',
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { actorId: 'actor-1', action: 'admin.user.role_changed' },
      select: {
        id: true,
        actorId: true,
        actor: { select: { email: true } },
        action: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      cursor: { id: 'cursor-id' },
      skip: 1,
    });
  });

  it('returns no cursor when the last page contains no extra entry', async () => {
    const { service, prisma } = createService();
    prisma.auditLog.findMany.mockResolvedValue([]);

    await expect(service.list({ limit: 50 })).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      take: 51,
    }));
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

  it('can skip a success record owned by an atomic transaction while still auditing failures', async () => {
    const { service, prisma } = createService();
    const summarize = vi.fn(() => ({}));

    await expect(service.track(
      'user-id',
      'swap.evm.order.requested',
      { chainId: 1 },
      async () => 'order',
      summarize,
      { recordSuccess: false },
    )).resolves.toBe('order');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();

    const failure = new BadRequestException('provider rejected order');
    await expect(service.track(
      'user-id',
      'swap.evm.order.requested',
      { chainId: 1 },
      () => Promise.reject(failure),
      summarize,
      { recordSuccess: false },
    )).rejects.toBe(failure);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'user-id',
        action: 'swap.evm.order.requested',
        metadata: { chainId: 1, outcome: 'failure', failureStatus: 400 },
      },
    });
  });
});
