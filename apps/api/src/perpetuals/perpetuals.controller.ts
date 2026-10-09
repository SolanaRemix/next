import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PerpetualRiskCheckResult } from '@next/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { PerpetualRiskService } from './perpetual-risk.service.js';
import { RiskCheckDto } from './risk-check.dto.js';

@Controller('perpetuals')
export class PerpetualsController {
  constructor(
    private readonly riskService: PerpetualRiskService,
    private readonly audit: AuditService,
  ) {}

  @Post('risk-check')
  @Roles('Trader')
  @HttpCode(HttpStatus.OK)
  checkRisk(
    @Body() request: RiskCheckDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PerpetualRiskCheckResult> {
    return this.audit.track(
      user.id,
      'perpetual.risk_check.requested',
      {
        side: request.side,
        marginMode: request.marginMode,
        leverage: request.leverage,
      },
      () => this.riskService.check(request),
      (result) => ({
        eligible: result.eligible,
        notional: result.notional,
        failureReason: result.reason,
      }),
    );
  }
}
