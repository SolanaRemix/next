import { Module } from '@nestjs/common';
import { RedisThrottlerModule } from '../throttling/redis-throttler.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [RedisThrottlerModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
