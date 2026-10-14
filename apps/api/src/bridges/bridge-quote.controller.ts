import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CrossChainBridgeQuoteResponse } from '@next/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { BridgeQuoteDto } from './bridge-quote.dto.js';
import { BridgeQuoteService } from './bridge-quote.service.js';

@Controller('bridges')
export class BridgeQuoteController {
  constructor(
    private readonly quotes: BridgeQuoteService,
    private readonly audit: AuditService,
  ) {}

  @Post('quote')
  @Roles('Viewer')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  quote(
    @Body() request: BridgeQuoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CrossChainBridgeQuoteResponse> {
    return this.audit.track(
      user.id,
      'bridge.quote.requested',
      {
        fromChainId: request.fromChainId,
        toChainId: request.toChainId,
        slippageBps: request.slippageBps,
      },
      () => this.quotes.quote(request),
      (quote) => ({
        provider: quote.provider,
        routeTool: quote.routeTool,
        estimatedDurationSeconds: quote.estimatedDurationSeconds,
      }),
    );
  }
}
