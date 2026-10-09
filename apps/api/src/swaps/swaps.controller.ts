import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { SwapQuoteResponse } from '@next/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SwapQuoteDto } from './swap-quote.dto.js';
import { SwapQuoteService } from './swap-quote.service.js';

@Controller('swaps')
export class SwapsController {
  constructor(
    private readonly quoteService: SwapQuoteService,
    private readonly audit: AuditService,
  ) {}

  @Post('quote')
  @Roles('Viewer')
  @HttpCode(HttpStatus.OK)
  quote(
    @Body() request: SwapQuoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SwapQuoteResponse> {
    return this.audit.track(
      user.id,
      'swap.quote.requested',
      { chainId: request.chainId, maxSlippageBps: request.maxSlippageBps },
      () => this.quoteService.quote(request),
      (quote) => ({
        routeCount: quote.routes.length,
        unavailableProviderCount: quote.unavailableProviders.length,
      }),
    );
  }
}
