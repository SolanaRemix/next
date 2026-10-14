import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvmAllowanceDiscoveryService } from './evm-allowance-discovery.service.js';

const owner = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const spender = '0x3333333333333333333333333333333333333333';
const approvalTopic = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const symbol = `0x${Buffer.from('TOK').toString('hex').padEnd(64, '0')}`;
const decimals = `0x${18n.toString(16).padStart(64, '0')}`;
const rawAllowance = (10n ** 18n).toString(16).padStart(64, '0');
const approvalLog = {
  address: token,
  topics: [
    approvalTopic,
    `0x${owner.slice(2).padStart(64, '0')}`,
    `0x${spender.slice(2).padStart(64, '0')}`,
  ],
  data: '0x' + (10n ** 18n).toString(16).padStart(64, '0'),
  blockNumber: '0x100',
};

function createService(): EvmAllowanceDiscoveryService {
  const config = {
    get: vi.fn((key: string) => key === 'EVM_RPC_URL_1' ? 'https://rpc.example.test' : undefined),
  } as unknown as ConfigService;
  return new EvmAllowanceDiscoveryService(config);
}

function installRpc(currentAllowance = `0x${rawAllowance}`) {
  const fetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
    const request = JSON.parse(String(options?.body)) as {
      id: number;
      method: string;
      params: readonly unknown[];
    };
    const result = request.method === 'eth_blockNumber'
      ? '0x1388'
      : request.method === 'eth_getLogs'
        ? [approvalLog]
        : request.method === 'eth_call' && typeof request.params[0] === 'object'
          && request.params[0] !== null && 'data' in request.params[0]
          ? request.params[0].data === '0x95d89b41'
            ? symbol
            : request.params[0].data === '0x313ce567'
              ? decimals
              : currentAllowance
          : null;
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('EvmAllowanceDiscoveryService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('scans a bounded recent window and returns only currently nonzero allowances', async () => {
    const fetch = installRpc();

    const result = await createService().discover('0x1', owner, [token]);

    expect(result).toMatchObject({
      chainId: '0x1',
      owner,
      scannedFromBlock: '1',
      scannedToBlock: '5000',
      scannedBlockCount: 5_000,
      completeHistory: false,
      approvals: [{
        tokenAddress: token,
        tokenSymbol: 'TOK',
        tokenDecimals: 18,
        spender,
        allowanceRaw: (10n ** 18n).toString(),
        allowance: '1',
        lastApprovalBlock: '256',
      }],
    });
    const logRequest = fetch.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))
      .find((entry) => entry.method === 'eth_getLogs');
    expect(logRequest.params[0]).toMatchObject({
      fromBlock: '0x1',
      toBlock: '0x1388',
      topics: [approvalTopic, `0x${owner.slice(2).padStart(64, '0')}`],
    });
  });

  it('drops approvals whose allowance has since been revoked', async () => {
    installRpc(`0x${'0'.repeat(64)}`);
    const result = await createService().discover('0x1', owner, [token]);
    expect(result.approvals).toHaveLength(0);
  });

  it('fails safely for RPC errors, excessive logs, and unsupported chains', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'unsupported' },
    })));
    await expect(createService().discover('0x1', owner, [token]))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(createService().discover('0x999', owner, [token]))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body)) as { id: number; method: string };
      const result = request.method === 'eth_blockNumber' ? '0x1388' : Array(2_001).fill(approvalLog);
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    }));
    await expect(createService().discover('0x1', owner, [token]))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
