import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { SwapQuoteResponse } from '@next/types';
import { SwapQuoteDto } from './swap-quote.dto.js';
import { SwapQuoteService } from './swap-quote.service.js';

@Controller('swaps')
export class SwapsController {
  constructor(private readonly quoteService: SwapQuoteService) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  quote(@Body() request: SwapQuoteDto): Promise<SwapQuoteResponse> {
    return this.quoteService.quote(request);
  }
}
