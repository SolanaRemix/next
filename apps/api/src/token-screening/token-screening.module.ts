import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { TokenScreeningController } from './token-screening.controller.js';
import { TokenScreeningService } from './token-screening.service.js';

@Module({
  imports: [AuditModule],
  controllers: [TokenScreeningController],
  providers: [TokenScreeningService],
})
export class TokenScreeningModule {}
