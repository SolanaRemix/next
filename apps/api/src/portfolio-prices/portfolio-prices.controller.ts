import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PortfolioPricesResponse } from '@next/types';
import { Roles } from '../auth/auth.decorators.js';
import { EvmPortfolioPricesDto } from './portfolio-prices.dto.js';
import { SolanaPortfolioPricesDto } from './solana-portfolio-prices.dto.js';
import { PortfolioPricesService } from './portfolio-prices.service.js';

@Controller('portfolio')
export class PortfolioPricesController {
  constructor(private readonly prices: PortfolioPricesService) {}

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
