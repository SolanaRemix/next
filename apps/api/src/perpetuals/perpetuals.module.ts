import { Module } from '@nestjs/common';
import { PerpetualRiskService } from './perpetual-risk.service.js';
import { PerpetualsController } from './perpetuals.controller.js';

@Module({
  controllers: [PerpetualsController],
  providers: [PerpetualRiskService],
})
export class PerpetualsModule {}
