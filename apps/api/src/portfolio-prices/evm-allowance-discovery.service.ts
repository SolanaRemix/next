import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DiscoveredEvmAllowance,
  EvmAllowanceDiscoveryResponse,
} from '@next/types';

const supportedChains: Record<string, string> = {
  '0x1': '1',
  '0xa': '10',
  '0x38': '56',
  '0x89': '137',
  '0x2105': '8453',
  '0xa4b1': '42161',
  '0xa86a': '43114',
};
const approvalTopic = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const scanBlockLimit = 5_000n;
const maxLogCount = 2_000;
const maxAllowanceCount = 50;
const requestTimeoutMs = 8_000;

interface ApprovalCandidate {
  tokenAddress: string;
  spender: string;
  blockNumber: bigint;
}

interface TokenMetadata {
  symbol: string;
  decimals: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHex(value: unknown, exactBytes?: number): string {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(value)
    || (exactBytes !== undefined && value.length !== 2 + exactBytes * 2)) {
    throw new Error('RPC returned invalid hexadecimal data.');
  }
  return value.slice(2).toLowerCase();
}

function parseHexQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new Error('RPC returned an invalid block number or allowance.');
  }
  return BigInt(value);
}

function decodeAddressTopic(value: unknown): string {
  const topic = parseHex(value, 32);
  if (!/^0{24}[0-9a-f]{40}$/.test(topic)) throw new Error('RPC returned an invalid approval spender.');
  return `0x${topic.slice(24)}`;
}

function decodeSymbol(value: unknown): string {
  const data = parseHex(value);
  if (data.length < 64) throw new Error('RPC returned invalid token metadata.');
  let bytes: Uint8Array;
  if (data.length === 64) {
    const raw = Uint8Array.from(data.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
    const end = raw.indexOf(0);
    bytes = raw.slice(0, end === -1 ? raw.length : end);
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

function parseDecimals(value: unknown): number {
  parseHex(value, 32);
  const decimals = Number(BigInt(value as string));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('RPC returned unsupported token precision.');
  }
  return decimals;
}

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const current = index++;
      if (current >= values.length) return;
      const value = values[current];
      if (value === undefined) return;
      results[current] = await operation(value);
    }
  }));
  return results;
}

@Injectable()
export class EvmAllowanceDiscoveryService {
  private requestId = 0;

  constructor(private readonly config: ConfigService) {}

  async discover(
    chainId: string,
    owner: string,
    tokenAddresses: readonly string[],
  ): Promise<EvmAllowanceDiscoveryResponse> {
    const normalizedChainId = chainId.toLowerCase();
    const rpcChain = Object.hasOwn(supportedChains, normalizedChainId)
      ? supportedChains[normalizedChainId]
      : undefined;
    if (!rpcChain || !/^0x[a-fA-F0-9]{40}$/.test(owner)
      || tokenAddresses.length < 1 || tokenAddresses.length > 50
      || tokenAddresses.some((address) => !/^0x[a-fA-F0-9]{40}$/.test(address))) {
      throw new ServiceUnavailableException('Allowance discovery is unavailable for this request.');
    }
    const rpcUrl = this.config.get<string>(`EVM_RPC_URL_${rpcChain}`)?.trim();
    if (!rpcUrl) throw new ServiceUnavailableException('Allowance discovery RPC is not configured.');

    try {
      const latestBlock = parseHexQuantity(await this.rpc(rpcUrl, 'eth_blockNumber', []));
      const fromBlock = latestBlock >= scanBlockLimit - 1n ? latestBlock - scanBlockLimit + 1n : 0n;
      const tokenList = [...new Set(tokenAddresses.map((address) => address.toLowerCase()))];
      const rawLogs = await this.rpc(rpcUrl, 'eth_getLogs', [{
        address: tokenList,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${latestBlock.toString(16)}`,
        topics: [
          approvalTopic,
          `0x${owner.slice(2).toLowerCase().padStart(64, '0')}`,
        ],
      }]);
      if (!Array.isArray(rawLogs) || rawLogs.length > maxLogCount) {
        throw new Error('Approval history exceeds the supported scan limit.');
      }
      const knownTokens = new Set(tokenList);
      const candidates = new Map<string, ApprovalCandidate>();
      for (const rawLog of rawLogs) {
        if (!isRecord(rawLog) || !Array.isArray(rawLog.topics) || rawLog.topics.length !== 3) {
          throw new Error('RPC returned an invalid approval log.');
        }
        const tokenAddress = typeof rawLog.address === 'string' ? rawLog.address.toLowerCase() : '';
        if (!knownTokens.has(tokenAddress) || rawLog.topics[0] !== approvalTopic
          || parseHex(rawLog.topics[1], 32) !== owner.slice(2).toLowerCase().padStart(64, '0')) {
          throw new Error('RPC returned an unrelated approval log.');
        }
        const spender = decodeAddressTopic(rawLog.topics[2]);
        parseHex(rawLog.data, 32);
        const blockNumber = parseHexQuantity(rawLog.blockNumber);
        if (blockNumber < fromBlock || blockNumber > latestBlock) throw new Error('RPC returned an out-of-range approval log.');
        const key = `${tokenAddress}:${spender}`;
        const previous = candidates.get(key);
        if (!previous || previous.blockNumber < blockNumber) {
          candidates.set(key, { tokenAddress, spender, blockNumber });
        }
      }
      if (candidates.size > maxAllowanceCount) throw new Error('Discovered allowance list exceeds the supported limit.');

      const tokenMetadata = new Map<string, TokenMetadata>();
      await mapWithConcurrency(tokenList, 4, async (tokenAddress) => {
        const [symbol, decimals] = await Promise.all([
          this.rpc(rpcUrl, 'eth_call', [{ to: tokenAddress, data: '0x95d89b41' }, 'latest']),
          this.rpc(rpcUrl, 'eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']),
        ]);
        tokenMetadata.set(tokenAddress, {
          symbol: decodeSymbol(symbol),
          decimals: parseDecimals(decimals),
        });
      });

      const approvals = await mapWithConcurrency([...candidates.values()], 4, async (candidate) => {
        const allowanceData = '0xdd62ed3e'
          + owner.slice(2).toLowerCase().padStart(64, '0')
          + candidate.spender.slice(2).toLowerCase().padStart(64, '0');
        const currentValue = parseHexQuantity(await this.rpc(rpcUrl, 'eth_call', [
          { to: candidate.tokenAddress, data: allowanceData },
          'latest',
        ]));
        if (currentValue === 0n) return null;
        const metadata = tokenMetadata.get(candidate.tokenAddress);
        if (!metadata) throw new Error('Token metadata is unavailable.');
        return {
          tokenAddress: candidate.tokenAddress,
          tokenSymbol: metadata.symbol,
          tokenDecimals: metadata.decimals,
          spender: candidate.spender,
          allowanceRaw: currentValue.toString(),
          allowance: formatUnits(currentValue, metadata.decimals),
          lastApprovalBlock: candidate.blockNumber.toString(),
        } satisfies DiscoveredEvmAllowance;
      });

      return {
        chainId: normalizedChainId,
        owner,
        scannedFromBlock: fromBlock.toString(),
        scannedToBlock: latestBlock.toString(),
        scannedBlockCount: Number(latestBlock - fromBlock + 1n),
        completeHistory: false,
        approvals: approvals.filter((approval): approval is DiscoveredEvmAllowance => approval !== null),
        asOf: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Allowance discovery could not complete. The RPC may not support the bounded log scan or may be unavailable.',
      );
    }
  }

  private async rpc(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
    const id = ++this.requestId;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    }).catch(() => null);
    if (!response?.ok) throw new Error('Configured EVM RPC is unavailable.');
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload) || payload.id !== id || payload.jsonrpc !== '2.0'
      || payload.error !== undefined || !Object.hasOwn(payload, 'result')) {
      throw new Error('Configured EVM RPC returned an invalid response.');
    }
    return payload.result;
  }
}
