import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RedisThrottlerStorage } from '../throttling/redis-throttler.storage.js';

describe('HealthService', () => {
  it('returns liveness without querying dependencies', () => {
    const prisma = { $queryRaw: vi.fn() };
    const throttler = { checkHealth: vi.fn() };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      throttler as unknown as RedisThrottlerStorage,
    );

    expect(service.live()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(throttler.checkHealth).not.toHaveBeenCalled();
  });

  it('requires both PostgreSQL and shared throttling dependencies for readiness', async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ '?column?': 1 }]) };
    const throttler = { checkHealth: vi.fn(async () => undefined) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      throttler as unknown as RedisThrottlerStorage,
    );

    await expect(service.ready()).resolves.toEqual({ status: 'ready' });
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(throttler.checkHealth).toHaveBeenCalledOnce();
  });

  it('fails readiness without leaking dependency error details', async () => {
    const prisma = { $queryRaw: vi.fn(async () => { throw new Error('database password leaked'); }) };
    const throttler = { checkHealth: vi.fn(async () => undefined) };
    const service = new HealthService(
      prisma as unknown as PrismaService,
      throttler as unknown as RedisThrottlerStorage,
    );

    await expect(service.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.ready()).rejects.not.toThrow(/password leaked/);
  });
});
