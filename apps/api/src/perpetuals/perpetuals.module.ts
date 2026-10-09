import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PerpetualRiskService } from './perpetual-risk.service.js';
import { PerpetualsController } from './perpetuals.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [PerpetualsController],
  providers: [PerpetualRiskService],
})
export class PerpetualsModule {}
