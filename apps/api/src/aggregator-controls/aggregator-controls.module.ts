import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AggregatorControlsController } from './aggregator-controls.controller.js';
import { AggregatorControlsService } from './aggregator-controls.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AggregatorControlsController],
  providers: [AggregatorControlsService],
  exports: [AggregatorControlsService],
})
export class AggregatorControlsModule {}
