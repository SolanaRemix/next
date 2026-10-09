import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SwapQuoteService } from './swap-quote.service.js';
import { SwapsController } from './swaps.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [SwapsController],
  providers: [SwapQuoteService],
})
export class SwapsModule {}
