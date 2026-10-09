import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { ThrottlerStorage } from '@nestjs/throttler';

export interface RedisThrottleClient {
  isOpen: boolean;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: 'error', listener: () => void): unknown;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

const INCREMENT_SCRIPT = `
local blockedFor = redis.call('PTTL', KEYS[2])
if blockedFor > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1])) or 0
  local ttl = redis.call('PTTL', KEYS[1])
  return { hits, math.max(ttl, 0), 1, blockedFor }
end

local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if hits == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end

if hits > tonumber(ARGV[2]) then
  local blockDuration = tonumber(ARGV[3])
  if blockDuration > 0 then
    redis.call('PSETEX', KEYS[2], blockDuration, '1')
  end
  return { hits, ttl, 1, blockDuration }
end

return { hits, ttl, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();

  constructor(
    private readonly client: RedisThrottleClient | null,
    private readonly namespace = 'mega-gods:throttle',
  ) {
    this.client?.on('error', () => this.logger.error('Redis throttling connection error.'));
  }

  async onModuleInit(): Promise<void> {
    if (this.client && !this.client.isOpen) await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.client) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    const identity = createHash('sha256')
      .update(`${throttlerName}:${key}`, 'utf8')
      .digest('hex');
    const hashTag = `{${identity}}`;
    let result: unknown;
    try {
      result = await this.client.eval(INCREMENT_SCRIPT, {
        keys: [
          `${this.namespace}:${hashTag}:hits`,
          `${this.namespace}:${hashTag}:blocked`,
        ],
        arguments: [String(ttl), String(limit), String(blockDuration)],
      });
    } catch {
      this.logger.error('Redis throttling command failed.');
      throw new ServiceUnavailableException(
        'Shared request throttling is temporarily unavailable.',
      );
    }

    if (!Array.isArray(result) || result.length !== 4) {
      this.logger.error('Redis returned an invalid throttling response.');
      throw new ServiceUnavailableException(
        'Shared request throttling is temporarily unavailable.',
      );
    }

    const values = result.map(Number);
    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = values as [
      number,
      number,
      number,
      number,
    ];
    if (
      !Number.isSafeInteger(totalHits) ||
      !Number.isSafeInteger(timeToExpire) ||
      !Number.isSafeInteger(isBlocked) ||
      !Number.isSafeInteger(timeToBlockExpire) ||
      totalHits < 0 ||
      timeToExpire < 0 ||
      ![0, 1].includes(isBlocked) ||
      timeToBlockExpire < 0
    ) {
      this.logger.error('Redis returned invalid throttling values.');
      throw new ServiceUnavailableException(
        'Shared request throttling is temporarily unavailable.',
      );
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked: isBlocked === 1,
      timeToBlockExpire,
    };
  }
}
