import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EvmPortfolioPricesResponse } from '@next/types';

const requestTimeoutMs = 8_000;
const maxTokenAddresses = 50;
const chainMetadata: Record<string, { platform: string; nativeCoinId: string }> = {
  '0x1': { platform: 'ethereum', nativeCoinId: 'ethereum' },
  '0xa': { platform: 'optimistic-ethereum', nativeCoinId: 'ethereum' },
  '0x38': { platform: 'binance-smart-chain', nativeCoinId: 'binancecoin' },
  '0x89': { platform: 'polygon-pos', nativeCoinId: 'polygon-ecosystem-token' },
  '0x2105': { platform: 'base', nativeCoinId: 'ethereum' },
  '0xa4b1': { platform: 'arbitrum-one', nativeCoinId: 'ethereum' },
  '0xa86a': { platform: 'avalanche', nativeCoinId: 'avalanche-2' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUsdPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

@Injectable()
export class PortfolioPricesService {
  constructor(private readonly config: ConfigService) {}

  async getEvmPrices(
    chainId: string,
    tokenAddresses: readonly string[],
  ): Promise<EvmPortfolioPricesResponse> {
    const metadata = Object.prototype.hasOwnProperty.call(chainMetadata, chainId)
      ? chainMetadata[chainId]
      : undefined;
    if (!metadata) throw new ServiceUnavailableException('Pricing is unavailable for this EVM network.');
    if (tokenAddresses.length > maxTokenAddresses ||
      tokenAddresses.some((address) => !/^0x[a-fA-F0-9]{40}$/.test(address))) {
      throw new BadRequestException('Provide at most 50 valid EVM token contract addresses.');
    }
    const apiKey = this.config.get<string>('COINGECKO_API_KEY')?.trim();
    if (!apiKey) throw new ServiceUnavailableException('Portfolio pricing is not configured.');

    const nativeUrl = new URL('https://api.coingecko.com/api/v3/simple/price');
    nativeUrl.searchParams.set('ids', metadata.nativeCoinId);
    nativeUrl.searchParams.set('vs_currencies', 'usd');
    const nativeRequest = this.fetchJson(nativeUrl, apiKey);

    const normalizedAddresses = [...new Set(tokenAddresses.map((address) => address.toLowerCase()))];
    const tokenRequest = normalizedAddresses.length > 0
      ? this.fetchJson(this.tokenPricesUrl(metadata.platform, normalizedAddresses), apiKey)
      : Promise.resolve({} as Record<string, unknown>);
    const [nativeResult, tokenResult] = await Promise.allSettled([nativeRequest, tokenRequest]);
    if (
      nativeResult.status === 'rejected' &&
      (normalizedAddresses.length === 0 || tokenResult.status === 'rejected')
    ) {
      throw new ServiceUnavailableException('Portfolio price provider is unavailable.');
    }

    const nativeRecord = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
    const nativeQuote = isRecord(nativeRecord) && isRecord(nativeRecord[metadata.nativeCoinId])
      ? nativeRecord[metadata.nativeCoinId]
      : null;
    const nativePriceUsd = isRecord(nativeQuote) ? parseUsdPrice(nativeQuote.usd) : null;

    const tokenPrices = normalizedAddresses.map((address) => {
      const tokenQuote = tokenResult.status === 'fulfilled'
        ? tokenResult.value[address] ?? Object.entries(tokenResult.value)
          .find(([candidate]) => candidate.toLowerCase() === address)?.[1]
        : null;
      return {
        address,
        priceUsd: isRecord(tokenQuote) ? parseUsdPrice(tokenQuote.usd) : null,
      };
    });

    return {
      chainId,
      nativePriceUsd,
      tokenPrices,
      source: 'CoinGecko',
      asOf: new Date().toISOString(),
    };
  }

  private tokenPricesUrl(platform: string, tokenAddresses: readonly string[]): URL {
    const url = new URL(`https://api.coingecko.com/api/v3/simple/token_price/${platform}`);
    url.searchParams.set('contract_addresses', tokenAddresses.join(','));
    url.searchParams.set('vs_currencies', 'usd');
    return url;
  }

  private async fetchJson(url: URL, apiKey: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'x-cg-demo-api-key': apiKey },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException('Portfolio price provider is unavailable.');
    }
    if (!response.ok) throw new ServiceUnavailableException('Portfolio price provider is unavailable.');
    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data)) throw new ServiceUnavailableException('Portfolio price provider returned invalid data.');
    return data;
  }
}
