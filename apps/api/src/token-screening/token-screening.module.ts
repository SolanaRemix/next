import { Module } from '@nestjs/common';
import { TokenScreeningController } from './token-screening.controller.js';
import { TokenScreeningService } from './token-screening.service.js';

@Module({
  controllers: [TokenScreeningController],
  providers: [TokenScreeningService],
})
export class TokenScreeningModule {}
