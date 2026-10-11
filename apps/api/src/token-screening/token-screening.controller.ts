import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  EvmTokenRiskScreeningResponse,
  SolanaTokenRiskScreeningResponse,
} from '@next/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { EvmTokenScreeningDto } from './token-screening.dto.js';
import { SolanaTokenScreeningDto } from './solana-token-screening.dto.js';
import { TokenScreeningService } from './token-screening.service.js';

@Controller('token-screening')
export class TokenScreeningController {
  constructor(
    private readonly screening: TokenScreeningService,
    private readonly audit: AuditService,
  ) {}

  @Get('evm')
  @Roles('Viewer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  screenEvmToken(
    @Query() query: EvmTokenScreeningDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EvmTokenRiskScreeningResponse> {
    return this.audit.track(
      user.id,
      'token_screening.evm.requested',
      { chainId: query.chainId },
      () => this.screening.screenEvmToken(query.chainId, query.tokenAddress),
      (result) => ({
        riskLevel: result.riskLevel,
        observedSignals: result.observedSignals,
        totalSignals: result.totalSignals,
      }),
    );
  }

  @Get('solana')
  @Roles('Viewer')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  screenSolanaToken(
    @Query() query: SolanaTokenScreeningDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SolanaTokenRiskScreeningResponse> {
    return this.audit.track(
      user.id,
      'token_screening.solana.requested',
      { network: 'solana-mainnet' },
      () => this.screening.screenSolanaToken(query.mint),
      (result) => ({
        riskLevel: result.riskLevel,
        observedSignals: result.observedSignals,
        totalSignals: result.totalSignals,
      }),
    );
  }
}
