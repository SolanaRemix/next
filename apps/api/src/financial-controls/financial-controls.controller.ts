import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { UpdateExecutionControlDto } from './financial-controls.dto.js';
import { FinancialControlsService } from './financial-controls.service.js';

@Controller('admin/financial-controls')
@Roles('SuperAdmin')
export class FinancialControlsController {
  constructor(private readonly controls: FinancialControlsService) {}

  @Get('execution')
  getExecutionControl() {
    return this.controls.getExecutionControl();
  }

  @Patch('execution')
  setExecutionControl(
    @CurrentUser() actor: AuthUser,
    @Body() request: UpdateExecutionControlDto,
  ) {
    return this.controls.setExecutionControl(actor.id, request.enabled, request.reason);
  }
}
