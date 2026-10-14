import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { RedisThrottlerModule } from '../throttling/redis-throttler.module.js';
import { BridgeQuoteController } from './bridge-quote.controller.js';
import { BridgeQuoteService } from './bridge-quote.service.js';

@Module({
  imports: [AuditModule, RedisThrottlerModule],
  controllers: [BridgeQuoteController],
  providers: [BridgeQuoteService],
})
export class BridgesModule {}
