import { Module } from '@nestjs/common';
import { SolanaMarketController } from './solana-market.controller.js';
import { SolanaMarketService } from './solana-market.service.js';

@Module({
  controllers: [SolanaMarketController],
  providers: [SolanaMarketService],
})
export class SolanaMarketModule {}
