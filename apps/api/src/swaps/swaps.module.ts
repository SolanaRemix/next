import { Module } from '@nestjs/common';
import { SwapQuoteService } from './swap-quote.service.js';
import { SwapsController } from './swaps.controller.js';

@Module({
  controllers: [SwapsController],
  providers: [SwapQuoteService],
})
export class SwapsModule {}
