import { Controller, Get, Query } from '@nestjs/common';
import type { SolanaMarketSearchResponse } from '@next/types';
import { Roles } from '../auth/auth.decorators.js';
import { SolanaMarketSearchDto } from './solana-market.dto.js';
import { SolanaMarketService } from './solana-market.service.js';

@Controller('solana-market')
export class SolanaMarketController {
  constructor(private readonly market: SolanaMarketService) {}

  @Get('search')
  @Roles('Viewer')
  search(@Query() query: SolanaMarketSearchDto): Promise<SolanaMarketSearchResponse> {
    return this.market.search(query.query);
  }
}
