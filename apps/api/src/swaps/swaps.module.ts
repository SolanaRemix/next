import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SwapQuoteService } from './swap-quote.service.js';
import { SwapsController } from './swaps.controller.js';
import { SolanaSwapController } from './solana-swap.controller.js';
import { SolanaSwapExecutionService } from './solana-swap-execution.service.js';
import { FinancialControlsModule } from '../financial-controls/financial-controls.module.js';
import { EvmSwapController } from './evm-swap.controller.js';
import { EvmSwapExecutionService } from './evm-swap-execution.service.js';

@Module({
  imports: [AuditModule, FinancialControlsModule],
  controllers: [SwapsController, SolanaSwapController, EvmSwapController],
  providers: [SwapQuoteService, SolanaSwapExecutionService, EvmSwapExecutionService],
})
export class SwapsModule {}
