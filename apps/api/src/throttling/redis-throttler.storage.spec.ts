import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  RedisThrottlerStorage,
  type RedisThrottleClient,
  type ThrottlerStorageRecord,
} from './redis-throttler.storage.js';

function createStorage(reply: unknown = [2, 59_000, 0, 0]) {
  const client = {
    isOpen: false,
    on: vi.fn(),
    connect: vi.fn(async () => {
      client.isOpen = true;
    }),
    quit: vi.fn(async () => {
      client.isOpen = false;
    }),
    eval: vi.fn(async () => reply),
  };
  const storage = new RedisThrottlerStorage(
    client as unknown as RedisThrottleClient,
    'test:throttle',
  );
  return { storage, client };
}

describe('RedisThrottlerStorage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('connects to Redis and atomically increments namespaced, hashed keys', async () => {
    const { storage, client } = createStorage();
    await storage.onModuleInit();

    const result = await storage.increment('ip:127.0.0.1', 60_000, 10, 30_000, 'default');

    expect(client.connect).toHaveBeenCalledOnce();
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update('default:ip:127.0.0.1').digest('hex');
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining('redis.call'), {
      keys: [`test:throttle:{${hash}}:hits`, `test:throttle:{${hash}}:blocked`],
      arguments: ['60000', '10', '30000'],
    });
    expect(result).toEqual({
      totalHits: 2,
      timeToExpire: 59_000,
      isBlocked: false,
      timeToBlockExpire: 0,
    } satisfies ThrottlerStorageRecord);
  });

  it('returns active block information from Redis', async () => {
    const { storage } = createStorage([11, 25_000, 1, 12_000]);

    await expect(storage.increment('client-key', 60_000, 10, 30_000, 'default'))
      .resolves.toEqual({
        totalHits: 11,
        timeToExpire: 25_000,
        isBlocked: true,
        timeToBlockExpire: 12_000,
      });
  });

  it('uses the built-in in-memory store when Redis is not configured', async () => {
    const storage = new RedisThrottlerStorage(null);

    await expect(storage.increment('local', 60_000, 10, 0, 'default'))
      .resolves.toEqual({
        totalHits: 1,
        timeToExpire: expect.any(Number),
        isBlocked: false,
        timeToBlockExpire: 0,
      });
  });

  it('fails closed if Redis returns malformed data or a command fails', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const malformed = createStorage(['bad']);
    await expect(malformed.storage.increment('key', 60_000, 10, 0, 'default'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    const unavailable = createStorage();
    unavailable.client.eval.mockRejectedValue(new Error('connection lost'));
    await expect(unavailable.storage.increment('key', 60_000, 10, 0, 'default'))
      .rejects.toMatchObject({ status: 503 });
  });

  it('closes the Redis connection during shutdown', async () => {
    const { storage, client } = createStorage();
    await storage.onModuleInit();
    await storage.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledOnce();
  });
});
