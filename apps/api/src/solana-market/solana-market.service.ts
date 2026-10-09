import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  SolanaMarketSearchResponse,
  SolanaMarketToken,
} from '@next/types';

const requestTimeoutMs = 8_000;
const maxResults = 20;
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface TokenData {
  mint: string;
  name: string;
  symbol: string;
  decimals: number | null;
  logoUri: string | null;
  priceUsd: number | null;
  marketPrices: number[];
  liquidityUsd: number;
  volume24hUsd: number;
  venues: Set<string>;
  priceSource: SolanaMarketToken['priceSource'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : null;
}

function safeLogo(value: unknown): string | null {
  const candidate = safeText(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

@Injectable()
export class SolanaMarketService {
  async search(query: string): Promise<SolanaMarketSearchResponse> {
    const normalizedQuery = query.trim();
    const [tokenResult, dexResult] = await Promise.allSettled([
      this.searchJupiterTokens(normalizedQuery),
      this.searchDexMarkets(normalizedQuery),
    ]);
    const unavailableProviders: SolanaMarketSearchResponse['unavailableProviders'] = [];
    if (tokenResult.status === 'rejected') unavailableProviders.push('Jupiter');
    if (dexResult.status === 'rejected') unavailableProviders.push('DEX Screener');
    if (tokenResult.status === 'rejected' && dexResult.status === 'rejected') {
      throw new ServiceUnavailableException('Solana market data providers are unavailable.');
    }

    const tokens = new Map<string, TokenData>();
    if (tokenResult.status === 'fulfilled') {
      for (const item of tokenResult.value) {
        const mint = safeText(item.id ?? item.address, 64);
        if (!mint || !mintPattern.test(mint)) continue;
        const symbol = safeText(item.symbol, 24);
        if (!symbol) continue;
        const decimals = item.decimals;
        tokens.set(mint, {
          mint,
          name: safeText(item.name, 80) ?? symbol,
          symbol,
          decimals: typeof decimals === 'number' && Number.isInteger(decimals) &&
            decimals >= 0 && decimals <= 18 ? decimals : null,
          logoUri: safeLogo(item.icon ?? item.logoURI ?? item.logoUri),
          priceUsd: null,
          marketPrices: [],
          liquidityUsd: 0,
          volume24hUsd: 0,
          venues: new Set(),
          priceSource: null,
        });
      }
    }

    if (dexResult.status === 'fulfilled') {
      for (const pair of dexResult.value) {
        this.addPairToken(tokens, pair, 'baseToken', pair.priceUsd);
      }
    }

    const candidates = [...tokens.values()]
      .sort((left, right) => right.liquidityUsd - left.liquidityUsd)
      .slice(0, maxResults);
    const prices = await this.fetchJupiterPrices(candidates.map((token) => token.mint));
    if (prices) {
      for (const token of candidates) {
        const price = prices.get(token.mint);
        if (price) {
          token.priceUsd = price;
          token.priceSource = 'Jupiter';
        }
      }
    } else {
      if (!unavailableProviders.includes('Jupiter')) unavailableProviders.push('Jupiter');
    }

    const responseTokens = candidates.map((token) => {
      const prices = token.marketPrices;
      const low = prices.length > 0 ? Math.min(...prices) : null;
      const high = prices.length > 0 ? Math.max(...prices) : null;
      const marketSpreadBps = low && high && (high + low) > 0
        ? Math.round(((high - low) / ((high + low) / 2)) * 10_000)
        : null;
      return {
        mint: token.mint,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        logoUri: token.logoUri,
        priceUsd: token.priceUsd,
        marketSpreadBps,
        liquidityUsd: token.liquidityUsd > 0 ? token.liquidityUsd : null,
        volume24hUsd: token.volume24hUsd > 0 ? token.volume24hUsd : null,
        venues: [...token.venues].sort().slice(0, 8),
        priceSource: token.priceSource ?? (token.priceUsd ? 'DEX Screener' : null),
      } satisfies SolanaMarketToken;
    });

    return {
      query: normalizedQuery,
      tokens: responseTokens,
      unavailableProviders,
      asOf: new Date().toISOString(),
    };
  }

  private async searchJupiterTokens(query: string): Promise<Record<string, unknown>[]> {
    const url = new URL('https://api.jup.ag/tokens/v2/search');
    url.searchParams.set('query', query);
    const data = await this.fetchJson(url, this.jupiterHeaders());
    if (!Array.isArray(data)) throw new Error('Jupiter token search returned an invalid response.');
    return data.filter(isRecord);
  }

  private async searchDexMarkets(query: string): Promise<Record<string, unknown>[]> {
    const url = new URL('https://api.dexscreener.com/latest/dex/search');
    url.searchParams.set('q', query);
    const data = await this.fetchJson(url);
    if (!isRecord(data) || !Array.isArray(data.pairs)) {
      throw new Error('DEX Screener returned an invalid response.');
    }
    return data.pairs.filter((pair): pair is Record<string, unknown> =>
      isRecord(pair) && pair.chainId === 'solana');
  }

  private async fetchJupiterPrices(mints: string[]): Promise<Map<string, number> | null> {
    if (mints.length === 0) return new Map();
    const url = new URL('https://api.jup.ag/price/v3');
    url.searchParams.set('ids', mints.join(','));
    try {
      const data = await this.fetchJson(url, this.jupiterHeaders());
      if (!isRecord(data)) return null;
      const prices = new Map<string, number>();
      for (const [mint, entry] of Object.entries(data)) {
        if (!isRecord(entry) || !mintPattern.test(mint)) continue;
        const value = positiveNumber(entry.usdPrice);
        if (value) prices.set(mint, value);
      }
      return prices;
    } catch {
      return null;
    }
  }

  private addPairToken(
    tokens: Map<string, TokenData>,
    pair: Record<string, unknown>,
    tokenField: 'baseToken' | 'quoteToken',
    rawPrice: unknown,
  ): void {
    const candidate = pair[tokenField];
    if (!isRecord(candidate)) return;
    const mint = safeText(candidate.address, 64);
    const symbol = safeText(candidate.symbol, 24);
    if (!mint || !mintPattern.test(mint) || !symbol) return;
    let token = tokens.get(mint);
    if (!token) {
      token = {
        mint,
        name: safeText(candidate.name, 80) ?? symbol,
        symbol,
        decimals: null,
        logoUri: null,
        priceUsd: null,
        marketPrices: [],
        liquidityUsd: 0,
        volume24hUsd: 0,
        venues: new Set(),
        priceSource: null,
      };
      tokens.set(mint, token);
    }
    const price = positiveNumber(rawPrice);
    if (price) token.marketPrices.push(price);
    if (!token.priceUsd && price) {
      token.priceUsd = price;
      token.priceSource = 'DEX Screener';
    }
    const liquidity = isRecord(pair.liquidity) ? positiveNumber(pair.liquidity.usd) : null;
    if (liquidity) token.liquidityUsd = Math.max(token.liquidityUsd, liquidity);
    const volume = isRecord(pair.volume) ? positiveNumber(pair.volume.h24) : null;
    if (volume) token.volume24hUsd += volume;
    const dex = safeText(pair.dexId, 40);
    if (dex) token.venues.add(dex);
  }

  private jupiterHeaders(): Record<string, string> {
    const key = process.env.JUPITER_API_KEY;
    return key ? { 'x-api-key': key } : {};
  }

  private async fetchJson(url: URL, headers: Record<string, string> = {}): Promise<unknown> {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Market-data provider returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  }
}
