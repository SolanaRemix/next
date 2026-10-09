import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, createCluster } from 'redis';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Module({
  providers: [
    {
      provide: RedisThrottlerStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (!redisUrl) return new RedisThrottlerStorage(null);

        const endpoint = new URL(redisUrl);
        if (config.get<string>('NODE_ENV') !== 'production') {
          return new RedisThrottlerStorage(createClient({ url: redisUrl }));
        }

        return new RedisThrottlerStorage(createCluster({
          rootNodes: [{ url: redisUrl }],
          defaults: {
            ...(endpoint.username ? { username: decodeURIComponent(endpoint.username) } : {}),
            ...(endpoint.password ? { password: decodeURIComponent(endpoint.password) } : {}),
            ...(endpoint.protocol === 'rediss:'
              ? { socket: { tls: true, connectTimeout: 5_000 } }
              : {}),
          },
        }));
      },
    },
  ],
  exports: [RedisThrottlerStorage],
})
export class RedisThrottlerModule {}
