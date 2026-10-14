import { Module } from '@nestjs/common';
import { PortfolioPricesController } from './portfolio-prices.controller.js';
import { CrossChainPortfolioService } from './cross-chain-portfolio.service.js';
import { EvmAllowanceDiscoveryService } from './evm-allowance-discovery.service.js';
import { PortfolioPricesService } from './portfolio-prices.service.js';

@Module({
  controllers: [PortfolioPricesController],
  providers: [PortfolioPricesService, CrossChainPortfolioService, EvmAllowanceDiscoveryService],
})
export class PortfolioPricesModule {}
