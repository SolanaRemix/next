import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisThrottlerStorage } from '../throttling/redis-throttler.storage.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly throttlerStorage: RedisThrottlerStorage,
  ) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ status: 'ready' }> {
    const checks = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.throttlerStorage.checkHealth(),
    ]);
    if (checks.some((check) => check.status === 'rejected')) {
      throw new ServiceUnavailableException('Service dependencies are not ready.');
    }
    return { status: 'ready' };
  }
}
