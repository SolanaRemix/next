import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PerpetualRiskCheckResult } from '@next/types';
import { Roles } from '../auth/auth.decorators.js';
import { PerpetualRiskService } from './perpetual-risk.service.js';
import { RiskCheckDto } from './risk-check.dto.js';

@Controller('perpetuals')
export class PerpetualsController {
  constructor(private readonly riskService: PerpetualRiskService) {}

  @Post('risk-check')
  @Roles('Trader')
  @HttpCode(HttpStatus.OK)
  checkRisk(@Body() request: RiskCheckDto): PerpetualRiskCheckResult {
    return this.riskService.check(request);
  }
}
