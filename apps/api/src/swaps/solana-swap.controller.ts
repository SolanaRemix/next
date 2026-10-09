import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  SolanaSwapExecuteResponse,
  SolanaSwapOrderResponse,
} from '@next/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SolanaSwapExecutionService } from './solana-swap-execution.service.js';
import { SolanaSwapExecuteDto, SolanaSwapOrderDto } from './solana-swap.dto.js';

@Controller('swaps/solana')
export class SolanaSwapController {
  constructor(
    private readonly execution: SolanaSwapExecutionService,
    private readonly audit: AuditService,
  ) {}

  @Post('order')
  @Roles('Trader')
  @HttpCode(HttpStatus.OK)
  order(
    @Body() request: SolanaSwapOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SolanaSwapOrderResponse> {
    return this.audit.track(
      user.id,
      'swap.solana.order.requested',
      {
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amount: request.amount,
        taker: request.taker,
        idempotencyKey: request.idempotencyKey,
        slippagePolicy: 'Jupiter automatic RTSE',
      },
      () => this.execution.order(user.id, request),
      (order) => ({
        requestId: order.requestId,
        executionId: order.executionId,
        slippageBps: order.slippageBps,
        prioritizationFeeLamports: order.prioritizationFeeLamports,
        router: order.router,
        expiresAt: order.expiresAt,
      }),
    );
  }

  @Post('execute')
  @Roles('Trader')
  @HttpCode(HttpStatus.OK)
  execute(
    @Body() request: SolanaSwapExecuteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SolanaSwapExecuteResponse> {
    return this.audit.track(
      user.id,
      'swap.solana.execute.requested',
      {
        executionId: request.executionId,
        requestId: request.requestId,
        idempotencyKey: request.idempotencyKey,
      },
      () => this.execution.execute(user.id, request),
      (result) => ({
        executionStatus: result.status,
        signature: result.signature,
      }),
    );
  }

  @Get(':executionId')
  @Roles('Trader')
  status(
    @Param('executionId', new ParseUUIDPipe({ version: '4' })) executionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SolanaSwapExecuteResponse> {
    return this.execution.status(user.id, executionId);
  }
}
