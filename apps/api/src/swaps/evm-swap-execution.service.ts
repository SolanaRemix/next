import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  EvmSwapExecuteRequest,
  EvmSwapExecuteResponse,
  EvmSwapOrderRequest,
  EvmSwapOrderResponse,
} from '@next/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinancialControlsService } from '../financial-controls/financial-controls.service.js';

const orderLifetimeMs = 90_000;
const requestTimeoutMs = 12_000;
const supportedChainIds = new Set([1, 10, 56, 137, 8453, 42161, 43114]);
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;

interface EvmTransaction {
  to: string;
  data: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUnsignedInteger(value: unknown, field: string): string {
  if (
    (typeof value === 'string' && /^(?:0|[1-9]\d{0,77})$/.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  ) {
    return String(value);
  }
  throw new BadGatewayException(`0x returned an invalid ${field}.`);
}

function parseTransaction(value: unknown): EvmTransaction {
  if (!isRecord(value)) throw new BadGatewayException('0x returned an invalid transaction.');
  const { to, data, value: nativeValue } = value;
  if (
    typeof to !== 'string' || !addressPattern.test(to) ||
    typeof data !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(data)
  ) {
    throw new BadGatewayException('0x returned an invalid transaction.');
  }
  return {
    to,
    data,
    value: parseUnsignedInteger(nativeValue ?? '0', 'transaction value'),
  };
}

function parseOrderPayload(value: Prisma.JsonValue, row: {
  id: string;
  chainId: number;
  taker: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  minimumBuyAmount: string;
  allowanceSpender: string;
  transactionTo: string;
  transactionData: string;
  transactionValue: string;
  expiresAt: Date;
}): EvmSwapOrderResponse | null {
  if (!isRecord(value)) return null;
  const expiresAt = value.expiresAt;
  if (typeof expiresAt !== 'string') return null;
  return {
    executionId: row.id,
    chainId: row.chainId,
    taker: row.taker,
    sellToken: row.sellToken,
    buyToken: row.buyToken,
    sellAmount: row.sellAmount,
    buyAmount: row.buyAmount,
    minimumBuyAmount: row.minimumBuyAmount,
    allowanceSpender: row.allowanceSpender,
    transaction: {
      to: row.transactionTo,
      data: row.transactionData,
      value: row.transactionValue,
    },
    expiresAt,
  };
}

function parseSavedResult(value: Prisma.JsonValue): EvmSwapExecuteResponse | null {
  if (!isRecord(value)) return null;
  if (
    (value.status !== 'processing' && value.status !== 'success' && value.status !== 'failed') ||
    (value.transactionHash !== null && typeof value.transactionHash !== 'string') ||
    (value.error !== null && typeof value.error !== 'string')
  ) {
    return null;
  }
  return {
    status: value.status,
    transactionHash: value.transactionHash,
    error: value.error,
  };
}

@Injectable()
export class EvmSwapExecutionService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly controls: FinancialControlsService,
  ) {}

  async order(userId: string, request: EvmSwapOrderRequest): Promise<EvmSwapOrderResponse> {
    if (!supportedChainIds.has(request.chainId)) {
      throw new BadRequestException('Unsupported EVM chain.');
    }
    if (request.sellToken.toLowerCase() === request.buyToken.toLowerCase()) {
      throw new BadRequestException('Sell and buy tokens must be different.');
    }
    const existing = await this.prisma.evmSwapOrder.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: request.idempotencyKey } },
    });
    if (existing) return this.replayOrder(existing, request);

    const apiKey = this.config.get<string>('ZEROX_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('EVM swap execution is not configured.');
    await this.controls.assertExecutionEnabled();

    const url = new URL('https://api.0x.org/swap/allowance-holder/quote');
    url.search = new URLSearchParams({
      chainId: String(request.chainId),
      sellToken: request.sellToken,
      buyToken: request.buyToken,
      sellAmount: request.sellAmount,
      taker: request.taker,
      slippageBps: String(request.maxSlippageBps),
    }).toString();
    const rawQuote = await this.fetchJson(url, {
      headers: { '0x-version': 'v2', '0x-api-key': apiKey },
    });
    const quote = this.parseQuote(rawQuote, request);
    const minimumBuyAmount = (
      BigInt(quote.buyAmount) * BigInt(10_000 - request.maxSlippageBps) / 10_000n
    ).toString();
    const expiresAt = new Date(Date.now() + orderLifetimeMs);

    try {
      const row = await this.prisma.evmSwapOrder.create({
        data: {
          userId,
          idempotencyKey: request.idempotencyKey,
          chainId: request.chainId,
          taker: request.taker,
          sellToken: request.sellToken,
          buyToken: request.buyToken,
          sellAmount: request.sellAmount,
          buyAmount: quote.buyAmount,
          minimumBuyAmount,
          allowanceSpender: quote.allowanceSpender,
          transactionTo: quote.transaction.to,
          transactionData: quote.transaction.data,
          transactionValue: quote.transaction.value,
          expiresAt,
          orderPayload: { expiresAt: expiresAt.toISOString() },
        },
      });
      return {
        executionId: row.id,
        chainId: row.chainId,
        taker: row.taker,
        sellToken: row.sellToken,
        buyToken: row.buyToken,
        sellAmount: row.sellAmount,
        buyAmount: row.buyAmount,
        minimumBuyAmount: row.minimumBuyAmount,
        allowanceSpender: row.allowanceSpender,
        transaction: {
          to: row.transactionTo,
          data: row.transactionData,
          value: row.transactionValue,
        },
        expiresAt: row.expiresAt.toISOString(),
      };
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const winner = await this.prisma.evmSwapOrder.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: request.idempotencyKey } },
      });
      if (winner) return this.replayOrder(winner, request);
      throw new ConflictException('This EVM swap order has already been created.');
    }
  }

  async execute(userId: string, request: EvmSwapExecuteRequest): Promise<EvmSwapExecuteResponse> {
    const row = await this.prisma.evmSwapOrder.findFirst({
      where: { id: request.executionId, userId },
    });
    if (!row) throw new NotFoundException('EVM swap order was not found.');
    if (row.idempotencyKey !== request.idempotencyKey) {
      throw new ConflictException('Execution idempotency key does not match the order.');
    }
    if (!hashPattern.test(request.transactionHash)) {
      throw new BadRequestException('Transaction hash is invalid.');
    }
    if (row.transactionHash && row.transactionHash.toLowerCase() !== request.transactionHash.toLowerCase()) {
      throw new ConflictException('This swap order is already bound to another transaction.');
    }
    if (row.executionStatus === 'SUCCEEDED' || row.executionStatus === 'FAILED') {
      return parseSavedResult(row.executionResult) ??
        { status: 'processing', transactionHash: row.transactionHash, error: null };
    }

    const rpcUrl = this.config.get<string>(`EVM_RPC_URL_${row.chainId}`);
    if (!rpcUrl) {
      throw new ServiceUnavailableException(`EVM_RPC_URL_${row.chainId} is required to verify settlement.`);
    }
    const chainId = await this.rpc(rpcUrl, 'eth_chainId', []);
    if (typeof chainId !== 'string' || BigInt(chainId) !== BigInt(row.chainId)) {
      throw new ServiceUnavailableException('Configured EVM RPC endpoint returned the wrong chain.');
    }
    const transaction = await this.rpc(rpcUrl, 'eth_getTransactionByHash', [request.transactionHash]);
    if (transaction === null) {
      throw new ServiceUnavailableException('Transaction is not visible on the configured EVM RPC yet.');
    }
    if (!isRecord(transaction) || !this.matchesTransaction(transaction, row)) {
      throw new ConflictException('Submitted transaction does not match the signed swap order.');
    }

    await this.prisma.evmSwapOrder.updateMany({
      where: {
        id: row.id,
        userId,
        idempotencyKey: request.idempotencyKey,
        executionStatus: 'ORDERED',
        transactionHash: null,
      },
      data: {
        executionStatus: 'SUBMITTED',
        transactionHash: request.transactionHash.toLowerCase(),
      },
    });
    const latest = await this.prisma.evmSwapOrder.findFirst({ where: { id: row.id, userId } });
    if (!latest || latest.transactionHash?.toLowerCase() !== request.transactionHash.toLowerCase()) {
      throw new ConflictException('This swap order is already bound to another transaction.');
    }
    return this.reconcile(rpcUrl, latest);
  }

  async status(userId: string, executionId: string): Promise<EvmSwapExecuteResponse> {
    const row = await this.prisma.evmSwapOrder.findFirst({ where: { id: executionId, userId } });
    if (!row) throw new NotFoundException('EVM swap order was not found.');
    const saved = parseSavedResult(row.executionResult);
    if (saved && saved.status !== 'processing') return saved;
    if (!row.transactionHash || row.executionStatus === 'ORDERED') {
      return { status: 'processing', transactionHash: row.transactionHash, error: null };
    }
    const rpcUrl = this.config.get<string>(`EVM_RPC_URL_${row.chainId}`);
    if (!rpcUrl) {
      throw new ServiceUnavailableException(`EVM_RPC_URL_${row.chainId} is required to verify settlement.`);
    }
    return this.reconcile(rpcUrl, row);
  }

  private parseQuote(value: unknown, request: EvmSwapOrderRequest): {
    buyAmount: string;
    allowanceSpender: string;
    transaction: EvmTransaction;
  } {
    if (!isRecord(value) || !isRecord(value.issues) || !isRecord(value.issues.allowance)) {
      throw new BadGatewayException('0x response did not include a valid allowance and transaction.');
    }
    const buyAmount = parseUnsignedInteger(value.buyAmount, 'buy amount');
    const spender = value.issues.allowance.spender;
    const transaction = parseTransaction(value.transaction);
    if (
      buyAmount === '0' ||
      typeof spender !== 'string' || !addressPattern.test(spender) ||
      typeof value.sellAmount !== 'string' || value.sellAmount !== request.sellAmount ||
      typeof value.buyToken !== 'string' ||
      value.buyToken.toLowerCase() !== request.buyToken.toLowerCase() ||
      typeof value.sellToken !== 'string' ||
      value.sellToken.toLowerCase() !== request.sellToken.toLowerCase() ||
      (typeof value.taker === 'string' && value.taker.toLowerCase() !== request.taker.toLowerCase())
    ) {
      throw new BadGatewayException('0x returned a quote that does not match the requested swap.');
    }
    return { buyAmount, allowanceSpender: spender, transaction };
  }

  private replayOrder(
    row: Prisma.EvmSwapOrderGetPayload<object>,
    request: EvmSwapOrderRequest,
  ): EvmSwapOrderResponse {
    if (
      row.chainId !== request.chainId ||
      row.taker.toLowerCase() !== request.taker.toLowerCase() ||
      row.sellToken.toLowerCase() !== request.sellToken.toLowerCase() ||
      row.buyToken.toLowerCase() !== request.buyToken.toLowerCase() ||
      row.sellAmount !== request.sellAmount
    ) {
      throw new ConflictException('Idempotency key was already used for a different EVM swap.');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('EVM swap order expired. Request a fresh order.');
    }
    const response = parseOrderPayload(row.orderPayload, row);
    if (!response) throw new ServiceUnavailableException('Stored EVM swap order is invalid.');
    return response;
  }

  private async reconcile(rpcUrl: string, row: {
    id: string;
    userId: string;
    executionStatus: string;
    transactionHash: string | null;
  }): Promise<EvmSwapExecuteResponse> {
    if (!row.transactionHash) {
      return { status: 'processing', transactionHash: null, error: null };
    }
    const receipt = await this.rpc(rpcUrl, 'eth_getTransactionReceipt', [row.transactionHash]);
    if (receipt === null) {
      return { status: 'processing', transactionHash: row.transactionHash, error: null };
    }
    if (!isRecord(receipt) || typeof receipt.status !== 'string' ||
      receipt.transactionHash !== row.transactionHash) {
      throw new ServiceUnavailableException('EVM RPC returned an invalid transaction receipt.');
    }
    if (receipt.status !== '0x1' && receipt.status !== '0x0') {
      throw new ServiceUnavailableException('EVM RPC returned an unknown transaction status.');
    }
    const includedBlock = receipt.blockNumber;
    const latestBlock = await this.rpc(rpcUrl, 'eth_blockNumber', []);
    if (
      typeof includedBlock !== 'string' || !/^0x[0-9a-f]+$/i.test(includedBlock) ||
      typeof latestBlock !== 'string' || !/^0x[0-9a-f]+$/i.test(latestBlock)
    ) {
      throw new ServiceUnavailableException('EVM RPC returned an invalid block height.');
    }
    if (BigInt(latestBlock) < BigInt(includedBlock) + 1n) {
      return { status: 'processing', transactionHash: row.transactionHash, error: null };
    }
    const response: EvmSwapExecuteResponse = {
      status: receipt.status === '0x1' ? 'success' : 'failed',
      transactionHash: row.transactionHash,
      error: receipt.status === '0x0' ? 'The swap transaction reverted on-chain.' : null,
    };
    await this.prisma.evmSwapOrder.updateMany({
      where: { id: row.id, userId: row.userId, transactionHash: row.transactionHash, executionStatus: 'SUBMITTED' },
      data: {
        executionStatus: response.status === 'success' ? 'SUCCEEDED' : 'FAILED',
        executionResult: response as unknown as Prisma.InputJsonObject,
      },
    });
    return response;
  }

  private matchesTransaction(
    transaction: Record<string, unknown>,
    row: Prisma.EvmSwapOrderGetPayload<object>,
  ): boolean {
    const to = transaction.to;
    const from = transaction.from;
    const data = transaction.input ?? transaction.data;
    const value = transaction.value;
    return typeof to === 'string' && to.toLowerCase() === row.transactionTo.toLowerCase() &&
      typeof from === 'string' && from.toLowerCase() === row.taker.toLowerCase() &&
      typeof data === 'string' && data.toLowerCase() === row.transactionData.toLowerCase() &&
      typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) &&
      BigInt(value) === BigInt(row.transactionValue);
  }

  private async fetchJson(url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      throw new ServiceUnavailableException('0x swap service is unavailable.');
    }
    if (!response.ok) throw new BadGatewayException(`0x returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new BadGatewayException('0x returned invalid JSON.');
    }
  }

  private async rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException('EVM settlement RPC is unavailable.');
    }
    if (!response.ok) throw new ServiceUnavailableException('EVM settlement RPC is unavailable.');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException('EVM settlement RPC returned invalid JSON.');
    }
    if (!isRecord(body) || body.error !== undefined || !('result' in body)) {
      throw new ServiceUnavailableException('EVM settlement RPC returned an invalid response.');
    }
    return body.result;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
