import { Module } from '@nestjs/common';
import { FinancialControlsController } from './financial-controls.controller.js';
import { FinancialControlsService } from './financial-controls.service.js';

@Module({
  controllers: [FinancialControlsController],
  providers: [FinancialControlsService],
  exports: [FinancialControlsService],
})
export class FinancialControlsModule {}
