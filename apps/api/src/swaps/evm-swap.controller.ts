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
import type { EvmSwapExecuteResponse, EvmSwapOrderResponse } from '@next/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { EvmSwapExecuteDto, EvmSwapOrderDto } from './evm-swap.dto.js';
import { EvmSwapExecutionService } from './evm-swap-execution.service.js';

@Controller('swaps/evm')
export class EvmSwapController {
  constructor(
    private readonly execution: EvmSwapExecutionService,
    private readonly audit: AuditService,
  ) {}

  @Post('order')
  @Roles('Trader')
  @HttpCode(HttpStatus.OK)
  order(
    @Body() request: EvmSwapOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EvmSwapOrderResponse> {
    return this.audit.track(
      user.id,
      'swap.evm.order.requested',
      {
        chainId: request.chainId,
        taker: request.taker,
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        sellAmount: request.sellAmount,
        idempotencyKey: request.idempotencyKey,
      },
      () => this.execution.order(user.id, request),
      (order) => ({
        executionId: order.executionId,
        minimumBuyAmount: order.minimumBuyAmount,
        expiresAt: order.expiresAt,
      }),
      { recordSuccess: false },
    );
  }

  @Post('execute')
  @Roles('Trader')
  @HttpCode(HttpStatus.OK)
  execute(
    @Body() request: EvmSwapExecuteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<EvmSwapExecuteResponse> {
    return this.audit.track(
      user.id,
      'swap.evm.settlement.requested',
      { executionId: request.executionId, transactionHash: request.transactionHash },
      () => this.execution.execute(user.id, request),
      (result) => ({ settlementStatus: result.status, transactionHash: result.transactionHash }),
    );
  }

  @Get(':executionId')
  @Roles('Trader')
  status(
    @Param('executionId', new ParseUUIDPipe({ version: '4' })) executionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<EvmSwapExecuteResponse> {
    return this.execution.status(user.id, executionId);
  }
}
