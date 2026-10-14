import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type {
  CrossChainBridgeQuoteCost,
  CrossChainBridgeQuoteRequest,
  CrossChainBridgeQuoteResponse,
} from '@next/types';
import { RedisThrottlerStorage } from '../throttling/redis-throttler.storage.js';
import { solanaChainId } from './bridge-quote.dto.js';

const providerName = 'lifi-bridge';
const quoteTimeoutMs = 8_000;
const circuitFailureWindowMs = 30_000;
const circuitFailureThreshold = 5;
const circuitOpenDurationMs = 15_000;
const circuitProbeLeaseMs = quoteTimeoutMs + 2_000;
const supportedEvmChainIds = new Set([1, 10, 56, 137, 8453, 42161, 43114]);
const integerPattern = /^(?:0|[1-9]\d{0,77})$/;

const quoteDisclaimer =
  'Indicative cross-chain quote only. It is not an execution instruction or guarantee; refresh and independently review all details before any wallet signing.';

interface ValidatedQuote {
  toAmount: string;
  minimumToAmount: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  routeTool: string;
  routeToolName: string;
  estimatedDurationSeconds: number | null;
  costs: CrossChainBridgeQuoteCost[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function isAddressForChain(value: string, chainId: number): boolean {
  return chainId === solanaChainId
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    : supportedEvmChainIds.has(chainId) && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function matchesRequestedAddress(actual: unknown, expected: string, chainId: number): boolean {
  if (typeof actual !== 'string') return false;
  return chainId === solanaChainId
    ? actual === expected
    : actual.toLowerCase() === expected.toLowerCase();
}

function quoteCostEntries(
  value: unknown,
  kind: CrossChainBridgeQuoteCost['kind'],
): CrossChainBridgeQuoteCost[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((entry): CrossChainBridgeQuoteCost[] => {
    if (!isRecord(entry)) return [];
    const token = isRecord(entry.token) ? entry.token : null;
    const amount = typeof entry.amount === 'string' && integerPattern.test(entry.amount)
      ? entry.amount
      : null;
    const amountUsd = typeof entry.amountUSD === 'string' &&
      /^(?:0|[1-9]\d{0,15})(?:\.\d{1,18})?$/.test(entry.amountUSD)
      ? entry.amountUSD
      : null;
    const name = safeText(entry.name, 80) ?? (kind === 'gas' ? 'Gas' : 'Fee');
    const tokenSymbol = token ? safeText(token.symbol, 24) : null;
    if (amount === null && amountUsd === null) return [];
    return [{ kind, name, amount, tokenSymbol, amountUsd }];
  });
}

function validateQuote(
  data: unknown,
  request: CrossChainBridgeQuoteRequest,
): ValidatedQuote {
  if (!isRecord(data) || !isRecord(data.action) || !isRecord(data.estimate)) {
    throw new Error('LI.FI returned an invalid quote shape.');
  }
  const action = data.action;
  const estimate = data.estimate;
  if (action.fromChainId !== request.fromChainId ||
      action.toChainId !== request.toChainId ||
      !matchesRequestedAddress(action.fromToken && isRecord(action.fromToken)
        ? action.fromToken.address : undefined, request.fromToken, request.fromChainId) ||
      !matchesRequestedAddress(action.toToken && isRecord(action.toToken)
        ? action.toToken.address : undefined, request.toToken, request.toChainId) ||
      action.fromAmount !== request.fromAmount) {
    throw new Error('LI.FI quote did not match the requested transfer.');
  }
  const fromToken = action.fromToken;
  const toToken = action.toToken;
  if (!isRecord(fromToken) || !isRecord(toToken)) {
    throw new Error('LI.FI quote did not include token details.');
  }
  const toAmount = typeof estimate.toAmount === 'string' && integerPattern.test(estimate.toAmount)
    ? estimate.toAmount
    : null;
  const minimumToAmount =
    typeof estimate.toAmountMin === 'string' && integerPattern.test(estimate.toAmountMin)
      ? estimate.toAmountMin
      : null;
  const fromTokenSymbol = safeText(fromToken.symbol, 24);
  const toTokenSymbol = safeText(toToken.symbol, 24);
  const routeTool = safeText(data.tool, 80);
  const toolDetails = isRecord(data.toolDetails) ? data.toolDetails : null;
  const routeToolName = toolDetails ? safeText(toolDetails.name, 80) : null;
  const duration = estimate.estimatedExecutionDuration ??
    estimate.executionDuration ??
    estimate.estimatedDuration;
  const estimatedDurationSeconds = typeof duration === 'number' &&
    Number.isSafeInteger(duration) && duration >= 0 && duration <= 86_400
    ? duration
    : null;

  if (toAmount === null || minimumToAmount === null ||
      BigInt(minimumToAmount) > BigInt(toAmount) ||
      !fromTokenSymbol || !toTokenSymbol || !routeTool) {
    throw new Error('LI.FI quote contained invalid output or route details.');
  }

  return {
    toAmount,
    minimumToAmount,
    fromTokenSymbol,
    toTokenSymbol,
    routeTool,
    routeToolName: routeToolName ?? routeTool,
    estimatedDurationSeconds,
    costs: [
      ...quoteCostEntries(estimate.feeCosts, 'fee'),
      ...quoteCostEntries(estimate.gasCosts, 'gas'),
    ],
  };
}

@Injectable()
export class BridgeQuoteService {
  constructor(@Optional() private readonly cache?: RedisThrottlerStorage) {}

  async quote(request: CrossChainBridgeQuoteRequest): Promise<CrossChainBridgeQuoteResponse> {
    if (request.fromChainId === request.toChainId) {
      throw new BadRequestException('Bridge quotes require different source and destination chains.');
    }
    if (!isAddressForChain(request.fromToken, request.fromChainId) ||
        !isAddressForChain(request.toToken, request.toChainId) ||
        !isAddressForChain(request.fromAddress, request.fromChainId) ||
        !isAddressForChain(request.toAddress, request.toChainId)) {
      throw new BadRequestException('Token and wallet addresses must match their selected chains.');
    }

    const quote = await trace.getTracer('mega-gods-prompt-next-api').startActiveSpan(
      'bridge.quote.provider',
      {
        kind: SpanKind.CLIENT,
        attributes: { 'app.quote.provider': 'LI.FI' },
      },
      async (span) => {
        let outcome = 'error';
        try {
          if (this.cache && !await this.cache.claimProviderCircuitAttempt(
            providerName,
            circuitProbeLeaseMs,
          )) {
            outcome = 'circuit_open';
            throw new ServiceUnavailableException('Cross-chain quote provider is temporarily unavailable.');
          }
          let result: ValidatedQuote;
          try {
            result = await this.fetchQuote(request);
          } catch {
            outcome = 'failure';
            await this.cache?.recordProviderCircuitFailure(
              providerName,
              circuitFailureWindowMs,
              circuitFailureThreshold,
              circuitOpenDurationMs,
            );
            throw new ServiceUnavailableException('Cross-chain quote provider is temporarily unavailable.');
          }
          await this.cache?.recordProviderCircuitSuccess(providerName);
          outcome = 'success';
          return result;
        } finally {
          span.setAttribute('app.quote.outcome', outcome);
          if (outcome === 'failure' || outcome === 'error') {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
        }
      },
    );

    return {
      provider: 'LI.FI',
      fromChainId: request.fromChainId,
      toChainId: request.toChainId,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      toAmount: quote.toAmount,
      minimumToAmount: quote.minimumToAmount,
      fromTokenSymbol: quote.fromTokenSymbol,
      toTokenSymbol: quote.toTokenSymbol,
      routeTool: quote.routeTool,
      routeToolName: quote.routeToolName,
      estimatedDurationSeconds: quote.estimatedDurationSeconds,
      costs: quote.costs,
      quotedAt: new Date().toISOString(),
      disclaimer: quoteDisclaimer,
    };
  }

  private async fetchQuote(request: CrossChainBridgeQuoteRequest): Promise<ValidatedQuote> {
    const url = new URL('https://li.quest/v1/quote');
    url.search = new URLSearchParams({
      fromChain: String(request.fromChainId),
      toChain: String(request.toChainId),
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromAmount: request.fromAmount,
      fromAddress: request.fromAddress,
      toAddress: request.toAddress,
      slippage: String(request.slippageBps / 10_000),
      allowDestinationCall: 'false',
    }).toString();
    const apiKey = process.env.LIFI_API_KEY;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { 'x-lifi-api-key': apiKey } : {}),
        },
        signal: AbortSignal.timeout(quoteTimeoutMs),
      });
    } catch {
      throw new Error('LI.FI request failed.');
    }
    if (!response.ok) throw new Error(`LI.FI returned HTTP ${response.status}.`);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('LI.FI returned invalid JSON.');
    }
    return validateQuote(data, request);
  }
}
