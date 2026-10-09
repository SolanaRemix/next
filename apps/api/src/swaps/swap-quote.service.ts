import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  EvmQuoteProvider,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRouteQuote,
} from '@next/types';

const quoteTimeoutMs = 8_000;
const providerNames: EvmQuoteProvider[] = ['0x', '1inch', 'paraswap'];
const oneInchChainIds = new Set([1, 10, 56, 137, 8453, 42161, 43114]);
const zeroXChainIds = new Set([1, 10, 56, 137, 8453, 42161, 43114]);

interface ProviderQuoteResult {
  buyAmount: string;
  estimatedGas?: string;
}

interface QuoteProvider {
  readonly name: EvmQuoteProvider;
  quote(request: SwapQuoteRequest): Promise<ProviderQuoteResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function amountField(value: unknown, field: string): string {
  if (typeof value === 'string' && /^[1-9]\d{0,77}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error(`Aggregator response contained an invalid ${field}.`);
}

function optionalGas(value: unknown): string | undefined {
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

abstract class HttpQuoteProvider implements QuoteProvider {
  abstract readonly name: EvmQuoteProvider;
  protected abstract buildUrl(request: SwapQuoteRequest): string;
  protected abstract headers(): Record<string, string>;
  protected abstract parse(data: unknown): ProviderQuoteResult;

  async quote(request: SwapQuoteRequest): Promise<ProviderQuoteResult> {
    const response = await fetch(this.buildUrl(request), {
      headers: this.headers(),
      signal: AbortSignal.timeout(quoteTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`${this.name} returned HTTP ${response.status}.`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(`${this.name} returned invalid JSON.`);
    }
    return this.parse(data);
  }
}

class ZeroXQuoteProvider extends HttpQuoteProvider {
  readonly name = '0x' as const;

  protected buildUrl(request: SwapQuoteRequest): string {
    if (!zeroXChainIds.has(request.chainId)) throw new Error('0x does not support this chain.');
    const url = new URL('https://api.0x.org/swap/allowance-holder/quote');
    url.search = new URLSearchParams({
      chainId: String(request.chainId),
      sellToken: request.sellToken,
      buyToken: request.buyToken,
      sellAmount: request.sellAmount,
      slippageBps: String(request.maxSlippageBps),
    }).toString();
    return url.toString();
  }

  protected headers(): Record<string, string> {
    const apiKey = process.env.ZEROX_API_KEY;
    return {
      '0x-version': 'v2',
      ...(apiKey ? { '0x-api-key': apiKey } : {}),
    };
  }

  protected parse(data: unknown): ProviderQuoteResult {
    if (!isRecord(data)) throw new Error('0x response was not an object.');
    const gas = optionalGas(data.gas);
    return {
      buyAmount: amountField(data.buyAmount, 'buyAmount'),
      ...(gas ? { estimatedGas: gas } : {}),
    };
  }
}

class OneInchQuoteProvider extends HttpQuoteProvider {
  readonly name = '1inch' as const;

  protected buildUrl(request: SwapQuoteRequest): string {
    if (!oneInchChainIds.has(request.chainId)) throw new Error('1inch does not support this chain.');
    const baseUrl = (process.env.ONEINCH_API_BASE_URL ?? 'https://api.1inch.dev/swap/v6.0')
      .replace(/\/+$/, '');
    const url = new URL(`${baseUrl}/${request.chainId}/quote`);
    url.search = new URLSearchParams({
      src: request.sellToken,
      dst: request.buyToken,
      amount: request.sellAmount,
    }).toString();
    return url.toString();
  }

  protected headers(): Record<string, string> {
    const apiKey = process.env.ONEINCH_API_KEY;
    if (!apiKey) throw new Error('1inch is not configured.');
    return { Authorization: 'Bearer ' + apiKey };
  }

  protected parse(data: unknown): ProviderQuoteResult {
    if (!isRecord(data)) throw new Error('1inch response was not an object.');
    const gas = optionalGas(data.gas);
    return {
      buyAmount: amountField(data.dstAmount, 'dstAmount'),
      ...(gas ? { estimatedGas: gas } : {}),
    };
  }
}

class ParaSwapQuoteProvider extends HttpQuoteProvider {
  readonly name = 'paraswap' as const;

  protected buildUrl(request: SwapQuoteRequest): string {
    const url = new URL('https://api.paraswap.io/prices');
    url.search = new URLSearchParams({
      network: String(request.chainId),
      srcToken: request.sellToken,
      destToken: request.buyToken,
      amount: request.sellAmount,
      srcDecimals: String(request.sellDecimals),
      destDecimals: String(request.buyDecimals),
      side: 'SELL',
    }).toString();
    return url.toString();
  }

  protected headers(): Record<string, string> {
    return { Accept: 'application/json' };
  }

  protected parse(data: unknown): ProviderQuoteResult {
    if (!isRecord(data) || !isRecord(data.priceRoute)) {
      throw new Error('ParaSwap response did not contain a price route.');
    }
    const route = data.priceRoute;
    const gas = optionalGas(route.gasCost);
    return {
      buyAmount: amountField(route.destAmount, 'destAmount'),
      ...(gas ? { estimatedGas: gas } : {}),
    };
  }
}

@Injectable()
export class SwapQuoteService {
  private readonly providers: QuoteProvider[] = [
    new ZeroXQuoteProvider(),
    new OneInchQuoteProvider(),
    new ParaSwapQuoteProvider(),
  ];

  async quote(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    if (request.sellToken.toLowerCase() === request.buyToken.toLowerCase()) {
      throw new BadRequestException('Sell and buy tokens must be different.');
    }
    const outcomes = await Promise.allSettled(
      this.providers.map(async (provider) => ({
        provider: provider.name,
        result: await provider.quote(request),
      })),
    );
    const routes: SwapRouteQuote[] = [];
    const succeeded = new Set<EvmQuoteProvider>();
    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') continue;
      succeeded.add(outcome.value.provider);
      const buyAmount = outcome.value.result.buyAmount;
      const minimum = BigInt(buyAmount) *
        BigInt(10_000 - request.maxSlippageBps) /
        10_000n;
      routes.push({
        provider: outcome.value.provider,
        buyAmount,
        minimumBuyAmount: minimum.toString(),
        ...(outcome.value.result.estimatedGas
          ? { estimatedGas: outcome.value.result.estimatedGas }
          : {}),
      });
    }
    if (routes.length === 0) {
      throw new ServiceUnavailableException('No configured aggregator returned a swap quote.');
    }
    routes.sort((left, right) => {
      const leftAmount = BigInt(left.buyAmount);
      const rightAmount = BigInt(right.buyAmount);
      return leftAmount === rightAmount ? 0 : leftAmount > rightAmount ? -1 : 1;
    });

    return {
      chainId: request.chainId,
      sellToken: request.sellToken,
      buyToken: request.buyToken,
      sellAmount: request.sellAmount,
      maxSlippageBps: request.maxSlippageBps,
      routes,
      unavailableProviders: providerNames.filter((provider) => !succeeded.has(provider)),
      quotedAt: new Date().toISOString(),
    };
  }
}
