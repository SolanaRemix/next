import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  EvmTokenRiskScreeningResponse,
  SolanaTokenRiskScreeningResponse,
} from '@next/types';
import { Roles } from '../auth/auth.decorators.js';
import { EvmTokenScreeningDto } from './token-screening.dto.js';
import { SolanaTokenScreeningDto } from './solana-token-screening.dto.js';
import { TokenScreeningService } from './token-screening.service.js';

@Controller('token-screening')
export class TokenScreeningController {
  constructor(private readonly screening: TokenScreeningService) {}

  @Get('evm')
  @Roles('Viewer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  screenEvmToken(@Query() query: EvmTokenScreeningDto): Promise<EvmTokenRiskScreeningResponse> {
    return this.screening.screenEvmToken(query.chainId, query.tokenAddress);
  }

  @Get('solana')
  @Roles('Viewer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  screenSolanaToken(@Query() query: SolanaTokenScreeningDto): Promise<SolanaTokenRiskScreeningResponse> {
    return this.screening.screenSolanaToken(query.mint);
  }
}
