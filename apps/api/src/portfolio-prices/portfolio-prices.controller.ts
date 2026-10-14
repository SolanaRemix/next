import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CrossChainPortfolioResponse, PortfolioPricesResponse } from '@next/types';
import { Roles } from '../auth/auth.decorators.js';
import { CrossChainPortfolioDto } from './cross-chain-portfolio.dto.js';
import { CrossChainPortfolioService } from './cross-chain-portfolio.service.js';
import { EvmPortfolioPricesDto } from './portfolio-prices.dto.js';
import { SolanaPortfolioPricesDto } from './solana-portfolio-prices.dto.js';
import { PortfolioPricesService } from './portfolio-prices.service.js';

@Controller('portfolio')
export class PortfolioPricesController {
  constructor(
    private readonly prices: PortfolioPricesService,
    private readonly crossChainPortfolio: CrossChainPortfolioService,
  ) {}

  @Post('aggregate')
  @Roles('Viewer')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  aggregate(@Body() request: CrossChainPortfolioDto): Promise<CrossChainPortfolioResponse> {
    return this.crossChainPortfolio.aggregate(request.accounts);
  }

  @Post('evm-prices')
  @Roles('Viewer')
  @HttpCode(HttpStatus.OK)
  getEvmPrices(@Body() request: EvmPortfolioPricesDto): Promise<PortfolioPricesResponse> {
    return this.prices.getEvmPrices(request.chainId, request.tokenAddresses);
  }

  @Post('solana-prices')
  @Roles('Viewer')
  @HttpCode(HttpStatus.OK)
  getSolanaPrices(@Body() request: SolanaPortfolioPricesDto): Promise<PortfolioPricesResponse> {
    return this.prices.getSolanaPrices(request.chainId, request.tokenMints);
  }
}
