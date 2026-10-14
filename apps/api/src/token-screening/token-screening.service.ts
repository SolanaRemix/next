import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  EvmTokenRiskLevel,
  EvmTokenRiskScreeningResponse,
  EvmTokenRiskSignals,
  SolanaTokenRiskScreeningResponse,
  SolanaTokenRiskSignals,
} from '@next/types';
import { RedisThrottlerStorage } from '../throttling/redis-throttler.storage.js';

const requestTimeoutMs = 8_000;
const screeningCacheTtlMs = 10_000;
const circuitFailureWindowMs = 30_000;
const circuitFailureThreshold = 5;
const circuitOpenDurationMs = 15_000;
const circuitProbeLeaseMs = requestTimeoutMs + 2_000;
const riskLevels = ['unknown', 'low', 'medium', 'high', 'critical'] as const;
const supportedChainIds = new Set(['1', '10', '56', '137', '8453', '42161', '43114']);
const contractAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const solanaMintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const disclaimer = 'Risk indicators are provider-reported heuristics, may be incomplete or inaccurate, and are not a safety guarantee or financial advice.';
const solanaDisclaimer = 'GoPlus labels this Solana endpoint beta. Indicators may be incomplete or inaccurate and are not a safety guarantee or financial advice.';

type RawData = Record<string, unknown>;

function isRecord(value: unknown): value is RawData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function screeningCacheKey(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isEvmSignals(value: unknown): value is EvmTokenRiskSignals {
  if (!isRecord(value)) return false;
  const booleanKeys: Array<keyof EvmTokenRiskSignals> = [
    'honeypot',
    'openSource',
    'proxy',
    'mintable',
    'ownershipRecoverable',
    'ownerCanChangeBalance',
    'hiddenOwner',
    'selfDestruct',
    'externalCall',
    'blacklisted',
    'transferPausable',
    'slippageModifiable',
  ];
  return booleanKeys.every((key) => value[key] === null || typeof value[key] === 'boolean') &&
    ['buyTaxPercent', 'sellTaxPercent'].every((key) =>
      value[key] === null ||
      (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 100));
}

function isValidCachedEvmResponse(
  value: unknown,
  chainId: string,
  tokenAddress: string,
): value is EvmTokenRiskScreeningResponse {
  if (!isRecord(value) || !isEvmSignals(value.signals)) return false;
  const assessment = assessRisk(value.signals);
  const observedSignals = signalCoverage(value.signals);
  return value.chainId === chainId &&
    value.tokenAddress === tokenAddress &&
    value.source === 'GoPlus' &&
    (value.riskScore === null ||
      (typeof value.riskScore === 'number' && Number.isFinite(value.riskScore) &&
        value.riskScore >= 0 && value.riskScore <= 100)) &&
    riskLevels.includes(value.riskLevel as (typeof riskLevels)[number]) &&
    value.riskScore === assessment.riskScore &&
    value.riskLevel === assessment.riskLevel &&
    value.observedSignals === observedSignals &&
    value.totalSignals === Object.keys(value.signals).length &&
    Array.isArray(value.indicators) &&
    JSON.stringify(value.indicators) === JSON.stringify(assessment.indicators) &&
    validTimestamp(value.asOf) &&
    value.disclaimer === disclaimer;
}

function isSolanaSignals(value: unknown): value is SolanaTokenRiskSignals {
  if (!isRecord(value)) return false;
  const keys: Array<keyof SolanaTokenRiskSignals> = [
    'mintable',
    'freezable',
    'closable',
    'balanceMutable',
    'metadataMutable',
    'transferFeeEnabled',
    'transferFeeUpgradable',
    'transferHookPresent',
    'maliciousTransferHook',
    'transferHookUpgradable',
    'defaultAccountFrozen',
    'defaultAccountStateUpgradable',
    'nonTransferable',
    'trustedToken',
  ];
  return keys.every((key) => value[key] === null || typeof value[key] === 'boolean');
}

function isValidCachedSolanaResponse(
  value: unknown,
  mint: string,
): value is SolanaTokenRiskScreeningResponse {
  if (!isRecord(value) || !isSolanaSignals(value.signals)) return false;
  const assessment = assessSolanaRisk(value.signals);
  const observedSignals = Object.values(value.signals).filter((signal) => signal !== null).length;
  return value.network === 'solana-mainnet' &&
    value.tokenAddress === mint &&
    value.source === 'GoPlus Solana beta' &&
    (value.riskScore === null ||
      (typeof value.riskScore === 'number' && Number.isFinite(value.riskScore) &&
        value.riskScore >= 0 && value.riskScore <= 100)) &&
    riskLevels.includes(value.riskLevel as (typeof riskLevels)[number]) &&
    value.riskScore === assessment.riskScore &&
    value.riskLevel === assessment.riskLevel &&
    value.observedSignals === observedSignals &&
    value.totalSignals === Object.keys(value.signals).length &&
    Array.isArray(value.indicators) &&
    JSON.stringify(value.indicators) === JSON.stringify(assessment.indicators) &&
    validTimestamp(value.asOf) &&
    value.disclaimer === solanaDisclaimer;
}

function parseBoolean(value: unknown): boolean | null {
  if (value === true || value === '1' || value === 1) return true;
  if (value === false || value === '0' || value === 0) return false;
  return null;
}

function parseTax(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed * 100 : null;
}

function parseSignals(token: RawData): EvmTokenRiskSignals {
  return {
    honeypot: parseBoolean(token.is_honeypot),
    openSource: parseBoolean(token.is_open_source),
    proxy: parseBoolean(token.is_proxy),
    mintable: parseBoolean(token.is_mintable),
    ownershipRecoverable: parseBoolean(token.can_take_back_ownership),
    ownerCanChangeBalance: parseBoolean(token.owner_change_balance),
    hiddenOwner: parseBoolean(token.hidden_owner),
    selfDestruct: parseBoolean(token.selfdestruct),
    externalCall: parseBoolean(token.external_call),
    blacklisted: parseBoolean(token.is_blacklisted),
    transferPausable: parseBoolean(token.transfer_pausable),
    slippageModifiable: parseBoolean(token.slippage_modifiable),
    buyTaxPercent: parseTax(token.buy_tax),
    sellTaxPercent: parseTax(token.sell_tax),
  };
}

function signalCoverage(signals: EvmTokenRiskSignals): number {
  return Object.values(signals).filter((value) => value !== null).length;
}

function assessRisk(
  signals: EvmTokenRiskSignals,
): { riskScore: number | null; riskLevel: EvmTokenRiskLevel; indicators: string[] } {
  const weightedSignals: Array<[keyof EvmTokenRiskSignals, boolean, number, string]> = [
    ['honeypot', true, 100, 'Provider detected honeypot behavior'],
    ['blacklisted', true, 55, 'Token reports blacklist controls'],
    ['ownershipRecoverable', true, 35, 'Ownership can be recovered'],
    ['ownerCanChangeBalance', true, 35, 'Owner can change token balances'],
    ['hiddenOwner', true, 25, 'A hidden owner was reported'],
    ['selfDestruct', true, 50, 'Contract reports self-destruct capability'],
    ['mintable', true, 15, 'Token supply can be increased'],
    ['transferPausable', true, 20, 'Token transfers can be paused'],
    ['slippageModifiable', true, 20, 'Transaction slippage may be modified'],
    ['openSource', false, 25, 'Contract source is not verified as open source'],
    ['proxy', true, 10, 'Contract uses a proxy'],
  ];
  const indicators = weightedSignals
    .filter(([key, concerningValue]) => signals[key] === concerningValue)
    .map(([, , , indicator]) => indicator);

  for (const [label, tax] of [
    ['Buy', signals.buyTaxPercent],
    ['Sell', signals.sellTaxPercent],
  ] as const) {
    if (tax !== null && tax > 10) indicators.push(`${label} tax exceeds 10%`);
    else if (tax !== null && tax > 5) indicators.push(`${label} tax exceeds 5%`);
    else if (tax !== null && tax > 0) indicators.push(`${label} tax is non-zero`);
  }

  if (signals.honeypot === true) {
    return { riskScore: 100, riskLevel: 'critical', indicators };
  }
  if (signals.honeypot === null || signalCoverage(signals) < Object.keys(signals).length) {
    return { riskScore: null, riskLevel: 'unknown', indicators };
  }

  const score = Math.min(
    100,
    weightedSignals.reduce((sum, [key, concerningValue, weight]) =>
      sum + (signals[key] === concerningValue ? weight : 0), 0) +
    [signals.buyTaxPercent, signals.sellTaxPercent].reduce<number>((sum, tax) => {
      if (tax === null) return sum;
      return sum + (tax > 10 ? 20 : tax > 5 ? 10 : tax > 0 ? 5 : 0);
    }, 0),
  );
  const riskLevel: EvmTokenRiskLevel = score >= 75
    ? 'critical'
    : score >= 50
      ? 'high'
      : score >= 20
        ? 'medium'
        : 'low';
  return { riskScore: score, riskLevel, indicators };
}

function normalizeChainId(chainId: string): string | null {
  const normalized = chainId.toLowerCase().startsWith('0x')
    ? Number.parseInt(chainId, 16).toString(10)
    : chainId;
  return supportedChainIds.has(normalized) ? normalized : null;
}

function parseSolanaStatus(value: unknown): boolean | null {
  return isRecord(value) ? parseBoolean(value.status) : null;
}

function parseSolanaSignals(token: RawData): SolanaTokenRiskSignals {
  const transferHook = token.transfer_hook;
  const hookRecords = Array.isArray(transferHook) && transferHook.every(isRecord)
    ? transferHook
    : null;
  const currentFee = isRecord(token.transfer_fee) && isRecord(token.transfer_fee.current_fee_rate)
    ? token.transfer_fee.current_fee_rate.fee_rate
    : undefined;
  const feeRate = typeof currentFee === 'string' || typeof currentFee === 'number'
    ? Number(currentFee)
    : Number.NaN;
  const defaultState = token.default_account_state;

  return {
    mintable: parseSolanaStatus(token.mintable),
    freezable: parseSolanaStatus(token.freezable),
    closable: parseSolanaStatus(token.closable),
    balanceMutable: parseSolanaStatus(token.balance_mutable_authority),
    metadataMutable: parseSolanaStatus(token.metadata_mutable),
    transferFeeEnabled: Number.isFinite(feeRate) && feeRate >= 0 && feeRate <= 1
      ? feeRate > 0
      : null,
    transferFeeUpgradable: parseSolanaStatus(token.transfer_fee_upgradable),
    transferHookPresent: hookRecords ? hookRecords.length > 0 : null,
    maliciousTransferHook: hookRecords
      ? hookRecords.length === 0
        ? false
        : hookRecords.every((hook) => parseBoolean(hook.malicious_address) !== null)
          ? hookRecords.some((hook) => parseBoolean(hook.malicious_address) === true)
          : null
      : null,
    transferHookUpgradable: parseSolanaStatus(token.transfer_hook_upgradable),
    defaultAccountFrozen: defaultState === '0' || defaultState === '1' || defaultState === '2'
      ? defaultState === '2'
      : null,
    defaultAccountStateUpgradable: parseSolanaStatus(token.default_account_state_upgradable),
    nonTransferable: parseBoolean(token.none_transferable),
    trustedToken: parseBoolean(token.trusted_token),
  };
}

function assessSolanaRisk(
  signals: SolanaTokenRiskSignals,
): { riskScore: number | null; riskLevel: EvmTokenRiskLevel; indicators: string[] } {
  const weightedSignals: Array<[keyof SolanaTokenRiskSignals, boolean, number, string]> = [
    ['mintable', true, 10, 'Mint authority is active'],
    ['freezable', true, 30, 'Freeze authority is active'],
    ['closable', true, 55, 'Token program can be closed'],
    ['balanceMutable', true, 60, 'Authority can modify token balances'],
    ['metadataMutable', true, 10, 'Token metadata is mutable'],
    ['transferFeeEnabled', true, 10, 'Transfers currently incur a fee'],
    ['transferFeeUpgradable', true, 15, 'Transfer fee can be changed'],
    ['transferHookPresent', true, 15, 'Token has a transfer hook'],
    ['maliciousTransferHook', true, 100, 'Provider flagged a transfer hook as malicious'],
    ['transferHookUpgradable', true, 15, 'Transfer hook configuration can be changed'],
    ['defaultAccountFrozen', true, 50, 'New token accounts default to frozen'],
    ['defaultAccountStateUpgradable', true, 10, 'Default account state can be changed'],
    ['nonTransferable', true, 100, 'Token is non-transferable'],
  ];
  const indicators = weightedSignals
    .filter(([key, concerningValue]) => signals[key] === concerningValue)
    .map(([, , , indicator]) => indicator);
  if (signals.trustedToken === false) {
    indicators.push('Token is not labeled trusted by the provider');
  }

  if (signals.maliciousTransferHook === true || signals.nonTransferable === true) {
    return { riskScore: 100, riskLevel: 'critical', indicators };
  }
  if (Object.values(signals).some((value) => value === null)) {
    return { riskScore: null, riskLevel: 'unknown', indicators };
  }

  const score = Math.min(
    100,
    weightedSignals.reduce((sum, [key, concerningValue, weight]) =>
      sum + (signals[key] === concerningValue ? weight : 0), 0) +
      (signals.trustedToken === false ? 5 : 0),
  );
  const riskLevel: EvmTokenRiskLevel = score >= 75
    ? 'critical'
    : score >= 50
      ? 'high'
      : score >= 20
        ? 'medium'
        : 'low';
  return { riskScore: score, riskLevel, indicators };
}

@Injectable()
export class TokenScreeningService {
  constructor(
    @Optional() private readonly cache?: RedisThrottlerStorage,
  ) {}

  private async readCache(key: string): Promise<unknown> {
    try {
      const cached = await this.cache?.getTokenScreeningCache(key);
      return cached ? JSON.parse(cached) as unknown : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    try {
      await this.cache?.setTokenScreeningCache(key, JSON.stringify(value), screeningCacheTtlMs);
    } catch {
      // Screening remains available from the provider when its optional cache is unavailable.
    }
  }

  private async withProviderCircuit<T>(
    provider: string,
    unavailableMessage: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.cache?.claimProviderCircuitAttempt &&
      !await this.cache.claimProviderCircuitAttempt(
      provider,
      circuitProbeLeaseMs,
      )) {
      throw new ServiceUnavailableException(unavailableMessage);
    }

    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.cache?.recordProviderCircuitFailure?.(
        provider,
        circuitFailureWindowMs,
        circuitFailureThreshold,
        circuitOpenDurationMs,
      );
      throw error;
    }
    await this.cache?.recordProviderCircuitSuccess?.(provider);
    return result;
  }

  async screenEvmToken(
    requestedChainId: string,
    requestedTokenAddress: string,
  ): Promise<EvmTokenRiskScreeningResponse> {
    const chainId = normalizeChainId(requestedChainId);
    if (!chainId) {
      throw new ServiceUnavailableException('Token screening is unavailable for this network or token address.');
    }
    if (!contractAddressPattern.test(requestedTokenAddress)) {
      throw new BadRequestException('Provide a valid EVM token contract address.');
    }

    const tokenAddress = requestedTokenAddress.toLowerCase();
    const key = screeningCacheKey(`evm:${chainId}:${tokenAddress}`);
    const cached = await this.readCache(key);
    if (isValidCachedEvmResponse(cached, chainId, tokenAddress)) return cached;
    const screening = await this.withProviderCircuit(
      `goplus:evm:${chainId}`,
      'Token security provider is temporarily unavailable.',
      async () => {
        const url = new URL(`https://api.gopluslabs.io/api/v1/token_security/${chainId}`);
        url.searchParams.set('contract_addresses', tokenAddress);

        let response: Response;
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
        } catch {
          throw new ServiceUnavailableException('Token security provider is unavailable.');
        }
        if (!response.ok) {
          throw new ServiceUnavailableException('Token security provider is unavailable.');
        }

        const payload: unknown = await response.json().catch(() => null);
        if (!isRecord(payload) ||
          (payload.code !== 1 && payload.code !== '1') ||
          !isRecord(payload.result)) {
          throw new ServiceUnavailableException('Token security provider returned invalid data.');
        }
        const tokenResult = Object.entries(payload.result)
          .find(([address]) => address.toLowerCase() === tokenAddress)?.[1];
        const signals = isRecord(tokenResult) ? parseSignals(tokenResult) : parseSignals({});
        const assessment = assessRisk(signals);
        return {
          chainId,
          tokenAddress,
          source: 'GoPlus',
          ...assessment,
          observedSignals: signalCoverage(signals),
          totalSignals: Object.keys(signals).length,
          signals,
          asOf: new Date().toISOString(),
          disclaimer,
        } satisfies EvmTokenRiskScreeningResponse;
      },
    );
    await this.writeCache(key, screening);
    return screening;
  }

  async screenSolanaToken(mint: string): Promise<SolanaTokenRiskScreeningResponse> {
    if (!solanaMintPattern.test(mint)) {
      throw new BadRequestException('Provide a valid Solana token mint address.');
    }

    const normalizedMint = mint;
    const key = screeningCacheKey(`solana:${normalizedMint}`);
    const cached = await this.readCache(key);
    if (isValidCachedSolanaResponse(cached, normalizedMint)) return cached;
    const screening = await this.withProviderCircuit(
      'goplus:solana-mainnet',
      'Solana token security provider is temporarily unavailable.',
      async () => {
        const url = new URL('https://api.gopluslabs.io/api/v1/solana/token_security');
        url.searchParams.set('contract_addresses', normalizedMint);

        let response: Response;
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
        } catch {
          throw new ServiceUnavailableException('Solana token security provider is unavailable.');
        }
        if (!response.ok) {
          throw new ServiceUnavailableException('Solana token security provider is unavailable.');
        }

        const payload: unknown = await response.json().catch(() => null);
        if (!isRecord(payload) || payload.code !== 1 || !isRecord(payload.result)) {
          throw new ServiceUnavailableException('Solana token security provider returned invalid data.');
        }
        const tokenResult = Object.entries(payload.result)
          .find(([address]) => address === normalizedMint)?.[1];
        const signals = isRecord(tokenResult) ? parseSolanaSignals(tokenResult) : parseSolanaSignals({});

        return {
          network: 'solana-mainnet',
          tokenAddress: normalizedMint,
          source: 'GoPlus Solana beta',
          ...assessSolanaRisk(signals),
          observedSignals: Object.values(signals).filter((value) => value !== null).length,
          totalSignals: Object.keys(signals).length,
          signals,
          asOf: new Date().toISOString(),
          disclaimer: solanaDisclaimer,
        } satisfies SolanaTokenRiskScreeningResponse;
      },
    );
    await this.writeCache(key, screening);
    return screening;
  }
}
