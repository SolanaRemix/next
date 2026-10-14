import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { UpdateAggregatorControlDto } from './aggregator-controls.dto.js';
import { AggregatorControlsService } from './aggregator-controls.service.js';

@Controller('admin/aggregator-controls')
@Roles('SuperAdmin')
export class AggregatorControlsController {
  constructor(private readonly controls: AggregatorControlsService) {}

  @Get('evm-quotes')
  getEvmQuoteControl() {
    return this.controls.getControl();
  }

  @Patch('evm-quotes')
  updateEvmQuoteControl(
    @CurrentUser() actor: AuthUser,
    @Body() request: UpdateAggregatorControlDto,
  ) {
    return this.controls.updateControl(actor.id, request.enabledProviders, request.reason);
  }
}
