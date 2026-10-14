import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RedisThrottlerModule } from '../throttling/redis-throttler.module.js';
import { TokenScreeningController } from './token-screening.controller.js';
import { TokenScreeningService } from './token-screening.service.js';

@Module({
  imports: [AuditModule, RedisThrottlerModule],
  controllers: [TokenScreeningController],
  providers: [TokenScreeningService],
})
export class TokenScreeningModule {}
