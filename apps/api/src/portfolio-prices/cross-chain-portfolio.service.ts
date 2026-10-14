import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CrossChainPortfolioAccountRequest,
  CrossChainPortfolioAccountResult,
  CrossChainPortfolioAsset,
  CrossChainPortfolioResponse,
  WalletBalance,
} from '@next/types';
import { PortfolioPricesService } from './portfolio-prices.service.js';

const evmChains: Record<string, { nativeAsset: string; configId: string }> = {
  '0x1': { nativeAsset: 'ETH', configId: '1' },
  '0xa': { nativeAsset: 'ETH', configId: '10' },
  '0x38': { nativeAsset: 'BNB', configId: '56' },
  '0x89': { nativeAsset: 'POL', configId: '137' },
  '0x2105': { nativeAsset: 'ETH', configId: '8453' },
  '0xa4b1': { nativeAsset: 'ETH', configId: '42161' },
  '0xa86a': { nativeAsset: 'AVAX', configId: '43114' },
};
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const tokenPrograms = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
];
const requestTimeoutMs = 8_000;
const maxSolanaTokenAccounts = 1_000;

interface RpcResponse {
  result?: unknown;
  error?: unknown;
}

interface TokenBalance {
  mint: string;
  amount: bigint;
  decimals: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHexQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new Error('RPC returned an invalid numeric value.');
  }
  return BigInt(value);
}

function parseAbiUint(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error('RPC returned an invalid token balance.');
  }
  return BigInt(value);
}

function formatUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function decodeAbiString(value: unknown): string {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error('RPC returned invalid token metadata.');
  }
  const data = value.slice(2);
  let bytes: Uint8Array;
  if (data.length === 64) {
    bytes = Uint8Array.from(data.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
    const end = bytes.indexOf(0);
    bytes = bytes.slice(0, end === -1 ? bytes.length : end);
  } else {
    const offset = Number(BigInt(`0x${data.slice(0, 64)}`)) * 2;
    if (!Number.isSafeInteger(offset) || offset < 64 || offset % 64 !== 0 || offset + 64 > data.length) {
      throw new Error('RPC returned invalid token metadata.');
    }
    const length = Number(BigInt(`0x${data.slice(offset, offset + 64)}`));
    const start = offset + 64;
    if (!Number.isSafeInteger(length) || length < 1 || length > 32 || start + length * 2 > data.length) {
      throw new Error('RPC returned invalid token metadata.');
    }
    bytes = Uint8Array.from(data.slice(start, start + length * 2).match(/.{2}/g)
      ?.map((byte) => Number.parseInt(byte, 16)) ?? []);
  }
  const symbol = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!symbol || symbol.length > 32 || /[\u0000-\u001f\u007f]/.test(symbol)) {
    throw new Error('RPC returned invalid token metadata.');
  }
  return symbol;
}

function decodeAbiUint(value: unknown, maximum: bigint): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error('RPC returned invalid token precision.');
  }
  const result = BigInt(value);
  if (result > maximum) throw new Error('RPC returned unsupported token precision.');
  return Number(result);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await operation(value);
    }
  });
  await Promise.all(workers);
  return results;
}

@Injectable()
export class CrossChainPortfolioService {
  private requestId = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prices: PortfolioPricesService,
  ) {}

  async aggregate(
    accounts: readonly CrossChainPortfolioAccountRequest[],
  ): Promise<CrossChainPortfolioResponse> {
    if (accounts.length < 1 || accounts.length > 8) {
      throw new BadRequestException('Provide between 1 and 8 wallet accounts.');
    }
    const results = await mapWithConcurrency(accounts, 2, async (account) => {
      try {
        const balances = account.chain === 'evm'
          ? await this.getEvmBalances(account)
          : await this.getSolanaBalances(account);
        return await this.priceBalances(account, balances);
      } catch {
        return {
          account: {
            address: account.address,
            chain: account.chain,
            chainId: account.chainId,
          },
          available: false,
          assets: [],
          totalUsd: null,
        } satisfies CrossChainPortfolioAccountResult;
      }
    });
    const complete = results.length > 0 && results.every((account) => account.available && account.totalUsd !== null);
    const totalUsd = complete
      ? results.reduce((total, account) => total + (account.totalUsd ?? 0), 0)
      : null;
    return { accounts: results, totalUsd, complete, asOf: new Date().toISOString() };
  }

  private async getEvmBalances(account: CrossChainPortfolioAccountRequest): Promise<WalletBalance[]> {
    const chainId = account.chainId.toLowerCase();
    const chain = Object.hasOwn(evmChains, chainId) ? evmChains[chainId] : undefined;
    if (account.chain !== 'evm' || !chain || !evmAddressPattern.test(account.address)) {
      throw new BadRequestException('Unsupported EVM network or wallet address.');
    }
    if (account.tokenAddresses.length > 50 || account.tokenAddresses.some((address) => !evmAddressPattern.test(address))) {
      throw new BadRequestException('Provide at most 50 valid EVM token contract addresses.');
    }
    const rpcUrl = this.config.get<string>(`EVM_RPC_URL_${chain.configId}`)?.trim();
    if (!rpcUrl) throw new Error('EVM RPC is unavailable.');

    const nativeAmount = parseHexQuantity(await this.rpc(rpcUrl, 'eth_getBalance', [account.address, 'latest']));
    const tokens = [...new Set(account.tokenAddresses.map((address) => address.toLowerCase()))];
    const tokenBalances = await mapWithConcurrency(tokens, 4, async (tokenAddress) => {
      const ownerData = account.address.slice(2).toLowerCase().padStart(64, '0');
      const [symbolValue, decimalsValue, balanceValue] = await Promise.all([
        this.rpc(rpcUrl, 'eth_call', [{ to: tokenAddress, data: '0x95d89b41' }, 'latest']),
        this.rpc(rpcUrl, 'eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']),
        this.rpc(rpcUrl, 'eth_call', [{
          to: tokenAddress,
          data: `0x70a08231${ownerData}`,
        }, 'latest']),
      ]);
      const decimals = decodeAbiUint(decimalsValue, 36n);
      const amount = parseAbiUint(balanceValue);
      if (amount === 0n) return null;
      return {
        address: account.address,
        chain: 'evm',
        asset: decodeAbiString(symbolValue),
        amount: formatUnits(amount, decimals),
        decimals,
        tokenAddress,
        kind: 'token',
      } satisfies WalletBalance;
    });
    return [
      {
        address: account.address,
        chain: 'evm',
        asset: chain.nativeAsset,
        amount: formatUnits(nativeAmount, 18),
        decimals: 18,
        kind: 'native',
      },
      ...tokenBalances.filter((balance) => balance !== null),
    ];
  }

  private async getSolanaBalances(account: CrossChainPortfolioAccountRequest): Promise<WalletBalance[]> {
    if (account.chain !== 'solana' || account.chainId !== 'mainnet-beta'
      || !solanaAddressPattern.test(account.address) || account.tokenAddresses.length > 0) {
      throw new BadRequestException('Use a valid Solana mainnet account with no EVM token contracts.');
    }
    const rpcUrl = this.config.get<string>('SOLANA_RPC_URL')?.trim();
    if (!rpcUrl) throw new Error('Solana RPC is unavailable.');

    const [nativeResult, ...tokenResults] = await Promise.all([
      this.rpc(rpcUrl, 'getBalance', [account.address, { commitment: 'confirmed' }]),
      ...tokenPrograms.map((programId) => this.rpc(rpcUrl, 'getTokenAccountsByOwner', [
        account.address,
        { programId },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ])),
    ]);
    if (!isRecord(nativeResult) || !Number.isSafeInteger(nativeResult.value) || (nativeResult.value as number) < 0) {
      throw new Error('RPC returned an invalid native balance.');
    }

    const tokenBalances = new Map<string, TokenBalance>();
    let accountCount = 0;
    for (const result of tokenResults) {
      if (!isRecord(result) || !Array.isArray(result.value)) throw new Error('RPC returned invalid token accounts.');
      accountCount += result.value.length;
      if (accountCount > maxSolanaTokenAccounts) throw new Error('RPC returned too many token accounts.');
      for (const candidate of result.value) {
        const token = this.parseSolanaTokenAccount(candidate);
        const previous = tokenBalances.get(token.mint);
        if (previous && previous.decimals !== token.decimals) throw new Error('RPC returned inconsistent token precision.');
        const amount = (previous?.amount ?? 0n) + token.amount;
        if (amount > 18_446_744_073_709_551_615n) throw new Error('RPC returned an unsupported token amount.');
        tokenBalances.set(token.mint, { ...token, amount });
      }
    }
    return [
      {
        address: account.address,
        chain: 'solana',
        asset: 'SOL',
        amount: formatUnits(BigInt(nativeResult.value as number), 9),
        decimals: 9,
        kind: 'native',
      },
      ...[...tokenBalances.values()]
        .filter(({ amount }) => amount > 0n)
        .map(({ mint, amount, decimals }) => ({
          address: account.address,
          chain: 'solana' as const,
          asset: mint,
          amount: formatUnits(amount, decimals),
          decimals,
          tokenAddress: mint,
          kind: 'token' as const,
        })),
    ];
  }

  private parseSolanaTokenAccount(value: unknown): TokenBalance {
    if (!isRecord(value) || !isRecord(value.account)) throw new Error('RPC returned an invalid parsed token account.');
    const tokenAccount = value.account;
    if (!isRecord(tokenAccount.data)) throw new Error('RPC returned an invalid parsed token account.');
    const data = tokenAccount.data;
    if (!isRecord(data.parsed)) throw new Error('RPC returned an invalid parsed token account.');
    const parsed = data.parsed;
    if (!isRecord(parsed.info)) throw new Error('RPC returned an invalid parsed token account.');
    const info = parsed.info;
    const tokenAmount = info.tokenAmount;
    if (!isRecord(tokenAmount)) throw new Error('RPC returned an invalid parsed token account.');
    if (typeof info.mint !== 'string' || !solanaAddressPattern.test(info.mint)
      || typeof tokenAmount.amount !== 'string' || !/^(?:0|[1-9]\d{0,19})$/.test(tokenAmount.amount)
      || typeof tokenAmount.decimals !== 'number' || !Number.isInteger(tokenAmount.decimals)
      || tokenAmount.decimals < 0 || tokenAmount.decimals > 255) {
      throw new Error('RPC returned an invalid parsed token amount.');
    }
    const amount = BigInt(tokenAmount.amount);
    if (amount > 18_446_744_073_709_551_615n) throw new Error('RPC returned an unsupported token amount.');
    return { mint: info.mint, amount, decimals: tokenAmount.decimals };
  }

  private async priceBalances(
    account: CrossChainPortfolioAccountRequest,
    balances: readonly WalletBalance[],
  ): Promise<CrossChainPortfolioAccountResult> {
    const tokenBalances = balances.filter((balance) => balance.kind === 'token' && balance.tokenAddress);
    let prices: Awaited<ReturnType<PortfolioPricesService['getEvmPrices']>> | null = null;
    try {
      prices = account.chain === 'evm'
        ? await this.prices.getEvmPrices(account.chainId.toLowerCase(), tokenBalances.flatMap((balance) => (
          balance.tokenAddress ? [balance.tokenAddress] : []
        )))
        : await this.prices.getSolanaPrices(
          account.chainId,
          tokenBalances.flatMap((balance) => balance.tokenAddress ? [balance.tokenAddress] : []).slice(0, 50),
        );
    } catch {
      prices = null;
    }

    const assets: CrossChainPortfolioAsset[] = balances.map((balance) => {
      const tokenPrice = balance.tokenAddress
        ? prices?.tokenPrices.find(({ address }) => account.chain === 'evm'
          ? address.toLowerCase() === balance.tokenAddress?.toLowerCase()
          : address === balance.tokenAddress)?.priceUsd ?? null
        : prices?.nativePriceUsd ?? null;
      const valueUsd = tokenPrice === null ? null : Number(balance.amount) * tokenPrice;
      return {
        balance,
        priceUsd: tokenPrice,
        valueUsd: valueUsd !== null && Number.isFinite(valueUsd) && valueUsd >= 0 ? valueUsd : null,
      };
    });
    const totalUsd = assets.every((asset) => asset.valueUsd !== null)
      ? assets.reduce((total, asset) => total + (asset.valueUsd ?? 0), 0)
      : null;
    return {
      account: {
        address: account.address,
        chain: account.chain,
        chainId: account.chainId,
      },
      available: true,
      assets,
      totalUsd: totalUsd !== null && Number.isFinite(totalUsd) ? totalUsd : null,
    };
  }

  private async rpc(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
    const id = ++this.requestId;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new Error('Configured blockchain RPC is unavailable.');
    }
    if (!response.ok) throw new Error('Configured blockchain RPC is unavailable.');
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || payload.id !== id || payload.jsonrpc !== '2.0'
      || payload.error !== undefined || !Object.hasOwn(payload, 'result')) {
      const rpcResponse = isRecord(payload) ? payload as RpcResponse : null;
      if (rpcResponse?.error !== undefined) throw new Error('Configured blockchain RPC rejected the request.');
      throw new Error('Configured blockchain RPC returned an invalid response.');
    }
    return payload.result;
  }
}
