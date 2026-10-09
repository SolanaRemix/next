import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { EvmPortfolioPricesResponse } from '@next/types';
import { Roles } from '../auth/auth.decorators.js';
import { EvmPortfolioPricesDto } from './portfolio-prices.dto.js';
import { PortfolioPricesService } from './portfolio-prices.service.js';

@Controller('portfolio')
export class PortfolioPricesController {
  constructor(private readonly prices: PortfolioPricesService) {}

  @Post('evm-prices')
  @Roles('Viewer')
  @HttpCode(HttpStatus.OK)
  getEvmPrices(@Body() request: EvmPortfolioPricesDto): Promise<EvmPortfolioPricesResponse> {
    return this.prices.getEvmPrices(request.chainId, request.tokenAddresses);
  }
}
