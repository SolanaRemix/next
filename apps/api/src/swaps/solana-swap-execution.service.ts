import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type {
  SolanaSwapExecuteRequest,
  SolanaSwapExecuteResponse,
  SolanaSwapOrderRequest,
  SolanaSwapOrderResponse,
} from '@next/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinancialControlsService } from '../financial-controls/financial-controls.service.js';

const jupiterBaseUrl = 'https://api.jup.ag/swap/v2';
const maxSolanaTransactionBytes = 1232;
const maxU64 = 18_446_744_073_709_551_615n;
const requestTimeoutMs = 15_000;
const orderLifetimeMs = 60_000;
const executionRetryWaitMs = 20_000;
const defaultSolanaRpcUrl = 'https://api.mainnet-beta.solana.com';
const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

interface JupiterOrder {
  requestId: string;
  transaction: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  prioritizationFeeLamports: number | null;
  router: string | null;
  taker: string;
  expireAt?: string;
}

interface JupiterExecution {
  status: 'Success' | 'Failed';
  signature: string | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveIntegerString(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
}

function parseJupiterOrder(value: unknown, expected: SolanaSwapOrderRequest): JupiterOrder {
  if (!isRecord(value)) throw new BadGatewayException('Jupiter returned an invalid swap order.');
  const order = value;
  if (
    typeof order.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(order.requestId) ||
    typeof order.transaction !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(order.transaction) ||
    order.transaction.length === 0 ||
    Buffer.from(order.transaction, 'base64').length > maxSolanaTransactionBytes ||
    Buffer.from(order.transaction, 'base64').toString('base64') !== order.transaction ||
    order.inputMint !== expected.inputMint ||
    order.outputMint !== expected.outputMint ||
    order.inAmount !== expected.amount ||
    order.taker !== expected.taker ||
    !positiveIntegerString(order.outAmount) ||
    !positiveIntegerString(order.otherAmountThreshold) ||
    typeof order.slippageBps !== 'number' ||
    !Number.isInteger(order.slippageBps) ||
    order.slippageBps < 0 ||
    order.slippageBps > 10_000 ||
    (order.prioritizationFeeLamports !== undefined &&
      order.prioritizationFeeLamports !== null &&
      (!Number.isSafeInteger(order.prioritizationFeeLamports) ||
        Number(order.prioritizationFeeLamports) < 0)) ||
    (order.router !== undefined && order.router !== null && typeof order.router !== 'string')
  ) {
    throw new BadGatewayException('Jupiter returned an invalid or non-executable swap order.');
  }
  return {
    requestId: order.requestId,
    transaction: order.transaction,
    inputMint: order.inputMint,
    outputMint: order.outputMint,
    inAmount: order.inAmount,
    outAmount: order.outAmount,
    otherAmountThreshold: order.otherAmountThreshold,
    slippageBps: order.slippageBps,
    prioritizationFeeLamports: typeof order.prioritizationFeeLamports === 'number'
      ? order.prioritizationFeeLamports
      : null,
    router: typeof order.router === 'string' ? order.router : null,
    taker: order.taker,
    ...(typeof order.expireAt === 'string' ? { expireAt: order.expireAt } : {}),
  };
}

function parseSavedOrder(value: Prisma.JsonValue): SolanaSwapOrderResponse | null {
  if (!isRecord(value)) return null;
  const result = value;
  if (
    typeof result.requestId !== 'string' ||
    typeof result.transaction !== 'string' ||
    typeof result.inputMint !== 'string' ||
    typeof result.outputMint !== 'string' ||
    typeof result.inAmount !== 'string' ||
    typeof result.outAmount !== 'string' ||
    typeof result.minimumOutputAmount !== 'string' ||
    typeof result.slippageBps !== 'number' ||
    (typeof result.prioritizationFeeLamports !== 'number' &&
      result.prioritizationFeeLamports !== null) ||
    (typeof result.router !== 'string' && result.router !== null) ||
    typeof result.expiresAt !== 'string'
  ) {
    return null;
  }
  return {
    executionId: typeof result.executionId === 'string' ? result.executionId : '',
    requestId: result.requestId,
    transaction: result.transaction,
    inputMint: result.inputMint,
    outputMint: result.outputMint,
    inAmount: result.inAmount,
    outAmount: result.outAmount,
    minimumOutputAmount: result.minimumOutputAmount,
    slippageBps: result.slippageBps,
    prioritizationFeeLamports: result.prioritizationFeeLamports,
    router: result.router,
    expiresAt: result.expiresAt,
  };
}

function parseExecution(value: unknown): JupiterExecution | null {
  if (!isRecord(value) || (value.status !== 'Success' && value.status !== 'Failed')) return null;
  const signature = typeof value.signature === 'string' &&
    /^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(value.signature)
    ? value.signature
    : null;
  const error = typeof value.error === 'string' ? value.error.slice(0, 300) : null;
  if (value.status === 'Success' && !signature) return null;
  return { status: value.status, signature, error };
}

function toExecutionResponse(value: Prisma.JsonValue | null): SolanaSwapExecuteResponse | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== 'processing' &&
    value.status !== 'success' &&
    value.status !== 'failed'
  ) return null;
  return {
    status: value.status,
    signature: typeof value.signature === 'string' ? value.signature : null,
    error: typeof value.error === 'string' ? value.error : null,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = base58Alphabet[remainder] + encoded;
    value /= 58n;
  }
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  return '1'.repeat(leadingZeroes) + encoded;
}

function transactionSignature(transaction: Uint8Array): string | null {
  let count = 0;
  let offset = 0;
  let shift = 0;
  let terminated = false;
  while (offset < transaction.length && shift <= 14) {
    const byte = transaction[offset];
    if (byte === undefined) return null;
    offset += 1;
    count |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      terminated = true;
      break;
    }
    shift += 7;
  }
  if (!terminated || count < 1 || count > 19 || transaction.length < offset + 64) return null;
  const firstSignature = transaction.subarray(offset, offset + 64);
  if (firstSignature.every((byte) => byte === 0)) return null;
  return encodeBase58(firstSignature);
}

@Injectable()
export class SolanaSwapExecutionService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly controls: FinancialControlsService,
  ) {}

  async order(userId: string, request: SolanaSwapOrderRequest): Promise<SolanaSwapOrderResponse> {
    await this.controls.assertExecutionEnabled();
    if (request.inputMint === request.outputMint) {
      throw new ConflictException('Input and output tokens must be different.');
    }
    if (BigInt(request.amount) > maxU64) {
      throw new ConflictException('Swap amount exceeds the supported Solana token amount.');
    }
    const existing = await this.prisma.solanaSwapOrder.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: request.idempotencyKey } },
    });
    if (existing) return this.replayOrder(existing, request);

    const apiKey = this.config.get<string>('JUPITER_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('Solana swap execution is not configured.');
    const url = new URL(`${jupiterBaseUrl}/order`);
    url.searchParams.set('inputMint', request.inputMint);
    url.searchParams.set('outputMint', request.outputMint);
    url.searchParams.set('amount', request.amount);
    url.searchParams.set('taker', request.taker);
    url.searchParams.set('maxSupportedTransactionVersion', '0');
    // Omitting slippage and fee overrides delegates RTSE and landing-fee optimization to Jupiter.
    await this.controls.assertExecutionEnabled();
    const providerOrder = await this.fetchJson(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    const order = parseJupiterOrder(providerOrder, request);
    const now = Date.now();
    const maximumExpiry = now + orderLifetimeMs;
    const providerExpiry = order.expireAt ? Date.parse(order.expireAt) : Number.NaN;
    const expiresAt = new Date(
      Number.isFinite(providerExpiry) && providerExpiry > now
        ? Math.min(providerExpiry, maximumExpiry)
        : maximumExpiry,
    );
    const response: SolanaSwapOrderResponse = {
      executionId: randomUUID(),
      requestId: order.requestId,
      transaction: order.transaction,
      inputMint: order.inputMint,
      outputMint: order.outputMint,
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      minimumOutputAmount: order.otherAmountThreshold,
      slippageBps: order.slippageBps,
      prioritizationFeeLamports: order.prioritizationFeeLamports,
      router: order.router,
      expiresAt: expiresAt.toISOString(),
    };
    try {
      const created = await this.prisma.solanaSwapOrder.create({
        data: {
          id: response.executionId,
          userId,
          idempotencyKey: request.idempotencyKey,
          requestId: order.requestId,
          taker: request.taker,
          inputMint: request.inputMint,
          outputMint: request.outputMint,
          inputAmount: request.amount,
          orderPayload: response as unknown as Prisma.InputJsonObject,
          expiresAt,
        },
      });
      return { ...response, executionId: created.id };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.prisma.solanaSwapOrder.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: request.idempotencyKey } },
      });
      if (winner) return this.replayOrder(winner, request);
      throw new ConflictException('This swap order has already been created.');
    }
  }

  async execute(
    userId: string,
    request: SolanaSwapExecuteRequest,
  ): Promise<SolanaSwapExecuteResponse> {
    const row = await this.prisma.solanaSwapOrder.findFirst({
      where: { id: request.executionId, requestId: request.requestId, userId },
    });
    if (!row) throw new NotFoundException('Swap order was not found.');

    const decodedTransaction = Buffer.from(request.signedTransaction, 'base64');
    if (
      decodedTransaction.length === 0 ||
      decodedTransaction.length > maxSolanaTransactionBytes ||
      decodedTransaction.toString('base64') !== request.signedTransaction
    ) {
      throw new ConflictException('Signed transaction is invalid or exceeds the Solana size limit.');
    }
    const signedTransactionHash = createHash('sha256').update(decodedTransaction).digest('hex');
    if (
      row.executionStatus !== 'ORDERED' &&
      (row.executionKey !== request.idempotencyKey ||
        row.signedTransactionHash !== signedTransactionHash)
    ) {
      throw new ConflictException('Retry must use the original idempotency key and signed transaction.');
    }
    const previousResponse = toExecutionResponse(row.executionResult);
    if (row.executionStatus === 'SUCCEEDED' || row.executionStatus === 'FAILED') {
      if (previousResponse) return previousResponse;
      return { status: 'processing', signature: null, error: null };
    }
    if (row.executionStatus === 'ORDERED' && row.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Swap order expired. Request a fresh order before signing.');
    }
    if (row.executionStatus === 'EXECUTING' && row.executionKey !== request.idempotencyKey) {
      throw new ConflictException('This swap order has already been submitted.');
    }

    const apiKey = this.config.get<string>('JUPITER_API_KEY');
    if (!apiKey) throw new ServiceUnavailableException('Solana swap execution is not configured.');
    const canRetryInFlight = row.executionStatus === 'EXECUTING' &&
      Date.now() - row.updatedAt.getTime() >= executionRetryWaitMs;
    if (row.executionStatus === 'EXECUTING' && !canRetryInFlight) {
      return { status: 'processing', signature: row.transactionSignature, error: null };
    }
    await this.controls.assertExecutionEnabled();
    let claimCount: number;
    try {
      const claim = await this.prisma.solanaSwapOrder.updateMany({
        where: row.executionStatus === 'ORDERED'
          ? { id: row.id, userId, executionStatus: 'ORDERED', executionKey: null }
          : {
            id: row.id,
            userId,
            executionStatus: 'EXECUTING',
            executionKey: request.idempotencyKey,
            updatedAt: row.updatedAt,
          },
        data: {
          executionStatus: 'EXECUTING',
          executionKey: request.idempotencyKey,
          transactionSignature: transactionSignature(decodedTransaction),
          signedTransactionHash,
        },
      });
      claimCount = claim.count;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Execution idempotency key has already been used.');
      }
      throw error;
    }
    if (claimCount !== 1) {
      const latest = await this.prisma.solanaSwapOrder.findUnique({ where: { id: row.id } });
      if (
        latest?.executionKey === request.idempotencyKey &&
        latest.signedTransactionHash !== signedTransactionHash
      ) {
        throw new ConflictException('Retry must use the original signed transaction.');
      }
      if (
        latest?.executionKey === request.idempotencyKey &&
        latest.executionResult
      ) {
        return toExecutionResponse(latest.executionResult) ??
          { status: 'processing', signature: null, error: null };
      }
      if (latest?.executionKey === request.idempotencyKey) {
        return { status: 'processing', signature: latest.transactionSignature, error: null };
      }
      throw new ConflictException('This swap order has already been submitted.');
    }

    try {
      await this.controls.assertExecutionEnabled();
    } catch (error) {
      await this.prisma.solanaSwapOrder.updateMany({
        where: {
          id: row.id,
          userId,
          executionStatus: 'EXECUTING',
          executionKey: request.idempotencyKey,
          signedTransactionHash,
        },
        data: {
          executionStatus: 'ORDERED',
          executionKey: null,
          transactionSignature: null,
          signedTransactionHash: null,
        },
      });
      throw error;
    }
    let providerResult: unknown;
    try {
      providerResult = await this.fetchJson(new URL(`${jupiterBaseUrl}/execute`), {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          signedTransaction: request.signedTransaction,
          requestId: request.requestId,
        }),
      });
    } catch (error) {
      // An interrupted request can have reached Jupiter; leave it claimed to prevent a duplicate broadcast.
      throw error;
    }

    const result = parseExecution(providerResult);
    if (!result) {
      throw new BadGatewayException('Jupiter returned an unknown execution status.');
    }
    const response: SolanaSwapExecuteResponse = {
      status: result.status === 'Success' ? 'success' : 'failed',
      signature: result.signature,
      error: result.error,
    };
    await this.prisma.solanaSwapOrder.update({
      where: { id: row.id },
      data: {
        executionStatus: result.status === 'Success' ? 'SUCCEEDED' : 'FAILED',
        executionResult: response as unknown as Prisma.InputJsonObject,
      },
    });
    return response;
  }

  async status(userId: string, executionId: string): Promise<SolanaSwapExecuteResponse> {
    const row = await this.prisma.solanaSwapOrder.findFirst({
      where: { id: executionId, userId },
    });
    if (!row) throw new NotFoundException('Swap order was not found.');
    const previous = toExecutionResponse(row.executionResult);
    if (previous && previous.status !== 'processing') return previous;
    if (row.executionStatus !== 'EXECUTING' || !row.transactionSignature) {
      return { status: 'processing', signature: row.transactionSignature, error: null };
    }

    const rpcUrl = this.config.get<string>('SOLANA_RPC_URL') ?? defaultSolanaRpcUrl;
    let providerStatus: unknown;
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignatureStatuses',
          params: [[row.transactionSignature], { searchTransactionHistory: true }],
        }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) return { status: 'processing', signature: row.transactionSignature, error: null };
      providerStatus = await response.json().catch(() => null);
    } catch {
      return { status: 'processing', signature: row.transactionSignature, error: null };
    }
    if (!isRecord(providerStatus) || !isRecord(providerStatus.result) ||
      !Array.isArray(providerStatus.result.value)) {
      return { status: 'processing', signature: row.transactionSignature, error: null };
    }
    const status = providerStatus.result.value[0];
    if (!isRecord(status)) {
      return { status: 'processing', signature: row.transactionSignature, error: null };
    }
    const hasError = status.err !== null && status.err !== undefined;
    const confirmed = status.confirmationStatus === 'confirmed' ||
      status.confirmationStatus === 'finalized' ||
      status.confirmations === null;
    if (!confirmed) {
      return { status: 'processing', signature: row.transactionSignature, error: null };
    }
    const result: SolanaSwapExecuteResponse = {
      status: hasError ? 'failed' : 'success',
      signature: row.transactionSignature,
      error: hasError ? JSON.stringify(status.err).slice(0, 300) : null,
    };
    await this.prisma.solanaSwapOrder.updateMany({
      where: { id: row.id, userId, executionStatus: 'EXECUTING' },
      data: {
        executionStatus: hasError ? 'FAILED' : 'SUCCEEDED',
        executionResult: result as unknown as Prisma.InputJsonObject,
      },
    });
    return result;
  }

  private replayOrder(
    row: {
      id: string;
      taker: string;
      inputMint: string;
      outputMint: string;
      inputAmount: string;
      orderPayload: Prisma.JsonValue;
      expiresAt: Date;
    },
    request: SolanaSwapOrderRequest,
  ): SolanaSwapOrderResponse {
    if (
      row.taker !== request.taker ||
      row.inputMint !== request.inputMint ||
      row.outputMint !== request.outputMint ||
      row.inputAmount !== request.amount
    ) {
      throw new ConflictException('Idempotency key was already used for a different swap.');
    }
    const response = parseSavedOrder(row.orderPayload);
    if (!response) throw new ServiceUnavailableException('Stored swap order is invalid.');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Swap order expired. Request a fresh order.');
    }
    return { ...response, executionId: row.id };
  }

  private async fetchJson(url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException('Jupiter swap service is unavailable.');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadGatewayException(`Jupiter swap request failed with HTTP ${response.status}.`);
    }
    if (!payload) throw new BadGatewayException('Jupiter returned an invalid response.');
    return payload;
  }
}
