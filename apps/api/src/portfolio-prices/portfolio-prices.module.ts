import { Module } from '@nestjs/common';
import { PortfolioPricesController } from './portfolio-prices.controller.js';
import { PortfolioPricesService } from './portfolio-prices.service.js';

@Module({
  controllers: [PortfolioPricesController],
  providers: [PortfolioPricesService],
})
export class PortfolioPricesModule {}
