import { makeApi, Zodios, type ZodiosOptions } from "@zodios/core";
import { z } from "zod";

const Credentials = z.object({
  email: z.string().max(254).email(),
  password: z.string().min(12).max(128),
});
const UserRole = z.enum([
  "SuperAdmin",
  "EnterpriseAdmin",
  "Trader",
  "Viewer",
  "Guest",
]);
const PublicUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRole,
});
const AuthSession = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: PublicUser,
});
const ApiError = z
  .object({
    statusCode: z.number().int(),
    message: z.union([z.string(), z.array(z.string())]),
    error: z.string().optional(),
  })
  .passthrough();
const RefreshSession = z
  .object({
    id: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    revokedAt: z.union([z.string(), z.null()]),
    current: z.boolean(),
  })
  .passthrough();
const ChangePassword = z.object({
  currentPassword: z.string().min(12).max(128),
  newPassword: z.string().min(12).max(128),
});
const PasswordChangeResult = z
  .object({
    revokedOtherSessions: z.number().int(),
    accessToken: z.string(),
    expiresIn: z.number().int(),
  })
  .passthrough();
const AdminUser = PublicUser.and(
  z
    .object({
      createdAt: z.string().datetime({ offset: true }),
      accountStatus: z.enum(["Active", "Restricted"]),
    })
    .passthrough()
);
const PaginatedUsers = z
  .object({
    items: z.array(AdminUser),
    nextCursor: z.union([z.string(), z.null()]),
  })
  .passthrough();
const assignUserRole_Body = z.object({ role: UserRole });
const updateUserStatus_Body = z.object({
  status: z.enum(["Active", "Restricted"]),
  reason: z.enum([
    "account_compromise",
    "policy_review",
    "legal_request",
    "other",
  ]),
});
const HealthStatus = z
  .object({ status: z.string(), checks: z.record(z.string()) })
  .partial()
  .passthrough();
const AuditLogPage = z.object({}).partial().passthrough();
const ExecutionControl = z
  .object({
    enabled: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();
const ExecutionControlUpdate = z.object({
  enabled: z.boolean(),
  reason: z.string().min(3).max(500).regex(/\S/),
});
const EvmQuoteProvider = z.enum(["0x", "1inch", "paraswap"]);
const AggregatorControl = z
  .object({ enabledProviders: z.array(EvmQuoteProvider) })
  .passthrough();
const AggregatorControlUpdate = z.object({
  enabledProviders: z.array(EvmQuoteProvider).max(3),
  reason: z.string().min(3).max(500),
});
const EvmAddress = z.string();
const EvmAllowanceDiscoveryRequest = z.object({
  chainId: z.enum(["0x1", "0xa", "0x38", "0x89", "0x2105", "0xa4b1", "0xa86a"]),
  owner: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
  tokenAddresses: z.array(EvmAddress).min(1).max(50),
});
const EvmAllowanceDiscoveryResponse = z
  .object({
    chainId: z.string(),
    owner: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
    scannedFromBlock: z.string(),
    scannedToBlock: z.string(),
    scannedBlockCount: z.number().int(),
    completeHistory: z.unknown(),
    approvals: z.array(
      z
        .object({
          tokenAddress: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
          tokenSymbol: z.string(),
          tokenDecimals: z.number().int(),
          spender: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
          allowanceRaw: z.string(),
          allowance: z.string(),
          lastApprovalBlock: z.string(),
        })
        .passthrough()
    ),
    asOf: z.string().datetime({ offset: true }),
  })
  .passthrough();
const CrossChainPortfolioRequest = z.object({
  accounts: z
    .array(
      z.object({
        chain: z.enum(["evm", "solana"]),
        chainId: z
          .string()
          .regex(/^(?:0x(?:1|a|38|89|2105|a4b1|a86a)|mainnet-beta)$/),
        address: z
          .string()
          .regex(/^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/),
        tokenAddresses: z.array(EvmAddress).max(50),
      })
    )
    .min(1)
    .max(8),
});
const WalletBalance = z
  .object({
    address: z.string(),
    chain: z.enum(["evm", "solana"]),
    asset: z.string(),
    amount: z.string(),
    decimals: z.number().int(),
    tokenAddress: z.string().optional(),
    kind: z.enum(["native", "token"]).optional(),
  })
  .passthrough();
const CrossChainPortfolioResponse = z
  .object({
    accounts: z.array(
      z
        .object({
          account: z
            .object({
              address: z.string(),
              chain: z.enum(["evm", "solana"]),
              chainId: z.string(),
            })
            .passthrough(),
          available: z.boolean(),
          assets: z.array(
            z
              .object({
                balance: WalletBalance,
                priceUsd: z.union([z.number(), z.null()]),
                valueUsd: z.union([z.number(), z.null()]),
              })
              .passthrough()
          ),
          totalUsd: z.union([z.number(), z.null()]),
        })
        .passthrough()
    ),
    totalUsd: z.union([z.number(), z.null()]),
    complete: z.boolean(),
    asOf: z.string().datetime({ offset: true }),
  })
  .passthrough();
const EvmPortfolioPricesRequest = z.object({
  chainId: z.enum(["0x1", "0xa", "0x38", "0x89", "0x2105", "0xa4b1", "0xa86a"]),
  tokenAddresses: z.array(EvmAddress).max(50),
});
const PortfolioPricesResponse = z
  .object({
    chainId: z.string(),
    nativePriceUsd: z.union([z.number(), z.null()]),
    tokenPrices: z.array(
      z
        .object({
          address: z.string(),
          priceUsd: z.union([z.number(), z.null()]),
        })
        .passthrough()
    ),
    source: z.unknown(),
    asOf: z.string().datetime({ offset: true }),
  })
  .passthrough();
const SolanaAddress = z.string();
const SolanaPortfolioPricesRequest = z.object({
  chainId: z.unknown(),
  tokenMints: z.array(SolanaAddress).max(50),
});
const RiskLevel = z.enum(["unknown", "low", "medium", "high", "critical"]);
const EvmTokenScreeningResponse = z
  .object({
    chainId: z.string(),
    tokenAddress: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
    source: z.unknown(),
    riskScore: z.union([z.number(), z.null()]),
    riskLevel: RiskLevel,
    observedSignals: z.number().int(),
    totalSignals: z.number().int(),
    signals: z.record(z.union([z.boolean(), z.number(), z.null()])),
    indicators: z.array(z.string()),
    asOf: z.string().datetime({ offset: true }),
    disclaimer: z.string(),
  })
  .passthrough();
const SolanaTokenScreeningResponse = z
  .object({
    network: z.unknown(),
    tokenAddress: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    source: z.unknown(),
    riskScore: z.union([z.number(), z.null()]),
    riskLevel: RiskLevel,
    observedSignals: z.number().int(),
    totalSignals: z.number().int(),
    signals: z.record(z.union([z.boolean(), z.number(), z.null()])),
    indicators: z.array(z.string()),
    asOf: z.string().datetime({ offset: true }),
    disclaimer: z.string(),
  })
  .passthrough();
const SolanaMarketSearchResponse = z
  .object({
    query: z.string(),
    tokens: z.array(
      z
        .object({
          mint: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
          name: z.string(),
          symbol: z.string(),
          decimals: z.union([z.number(), z.null()]),
          logoUri: z.union([z.string(), z.null()]),
          priceUsd: z.union([z.number(), z.null()]),
          marketSpreadBps: z.union([z.number(), z.null()]),
          liquidityUsd: z.union([z.number(), z.null()]),
          volume24hUsd: z.union([z.number(), z.null()]),
          venues: z.array(z.string()),
          priceSource: z.union([
            z.enum(["Jupiter", "DEX Screener", null]),
            z.null(),
          ]),
        })
        .passthrough()
    ),
    unavailableProviders: z.array(z.enum(["Jupiter", "DEX Screener"])),
    asOf: z.string().datetime({ offset: true }),
  })
  .passthrough();
const SwapQuoteRequest = z.object({
  chainId: z.union([
    z.literal(1),
    z.literal(10),
    z.literal(56),
    z.literal(137),
    z.literal(8453),
    z.literal(42161),
    z.literal(43114),
  ]),
  sellToken: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
  buyToken: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
  sellAmount: z.string().regex(/^[1-9]\d{0,77}$/),
  sellDecimals: z.number().int().gte(0).lte(36),
  buyDecimals: z.number().int().gte(0).lte(36),
  maxSlippageBps: z.number().int().gte(1).lte(5000),
});
const SwapQuoteResponse = z
  .object({
    chainId: z.number().int(),
    sellToken: z.string(),
    buyToken: z.string(),
    sellAmount: z.string(),
    maxSlippageBps: z.number().int(),
    routes: z.array(
      z
        .object({
          provider: EvmQuoteProvider,
          buyAmount: z.string(),
          minimumBuyAmount: z.string(),
          estimatedGas: z.string().optional(),
        })
        .passthrough()
    ),
    unavailableProviders: z.array(EvmQuoteProvider),
    quotedAt: z.string().datetime({ offset: true }),
  })
  .passthrough();
const BridgeQuoteRequest = z.object({
  fromChainId: z.union([
    z.literal(1),
    z.literal(10),
    z.literal(56),
    z.literal(137),
    z.literal(8453),
    z.literal(42161),
    z.literal(43114),
    z.literal(1151111081099710),
  ]),
  toChainId: z.union([
    z.literal(1),
    z.literal(10),
    z.literal(56),
    z.literal(137),
    z.literal(8453),
    z.literal(42161),
    z.literal(43114),
    z.literal(1151111081099710),
  ]),
  fromToken: z
    .string()
    .regex(/^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/),
  toToken: z
    .string()
    .regex(/^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/),
  fromAmount: z.string().regex(/^[1-9]\d{0,77}$/),
  fromAddress: z
    .string()
    .regex(/^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/),
  toAddress: z
    .string()
    .regex(/^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/),
  slippageBps: z.number().int().gte(1).lte(500),
});
const BridgeQuoteResponse = z
  .object({
    provider: z.unknown(),
    fromChainId: z.number().int(),
    toChainId: z.number().int(),
    fromToken: z.string(),
    toToken: z.string(),
    fromAmount: z.string(),
    toAmount: z.string(),
    minimumToAmount: z.string(),
    fromTokenSymbol: z.string(),
    toTokenSymbol: z.string(),
    routeTool: z.string(),
    routeToolName: z.string(),
    estimatedDurationSeconds: z.union([z.number(), z.null()]),
    costs: z.array(
      z
        .object({
          kind: z.enum(["fee", "gas"]),
          name: z.string(),
          amount: z.union([z.string(), z.null()]),
          tokenSymbol: z.union([z.string(), z.null()]),
          amountUsd: z.union([z.string(), z.null()]),
        })
        .passthrough()
    ),
    quotedAt: z.string().datetime({ offset: true }),
    disclaimer: z.string(),
  })
  .passthrough();
const PerpetualRiskCheckRequest = z.object({
  side: z.enum(["long", "short"]),
  marginMode: z.enum(["isolated", "cross"]),
  entryPrice: z.number().gt(0).lte(1000000000000),
  markPrice: z.number().gt(0).lte(1000000000000),
  quantity: z.number().gt(0).lte(1000000000),
  leverage: z.number().int().gte(1).lte(100),
  availableMargin: z.number().gte(0).lte(1000000000000),
  takeProfit: z.number().gt(0).lte(1000000000000).optional(),
  stopLoss: z.number().gt(0).lte(1000000000000).optional(),
});
const PerpetualRiskCheckResponse = z
  .object({
    eligible: z.boolean(),
    reason: z.union([z.string(), z.null()]),
    notional: z.number(),
    initialMargin: z.number(),
    requiredMargin: z.number(),
    estimatedLiquidationPrice: z.number(),
    unrealizedPnlAtMark: z.number(),
    maintenanceMarginAtMark: z.number(),
  })
  .passthrough();
const EvmSwapOrderRequest = SwapQuoteRequest.and(
  z
    .object({
      taker: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
      idempotencyKey: z.string().uuid(),
    })
    .passthrough()
);
const EvmSwapOrderResponse = z
  .object({
    executionId: z.string().uuid(),
    chainId: z.number().int(),
    taker: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
    sellToken: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
    buyToken: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
    sellAmount: z.string(),
    buyAmount: z.string(),
    minimumBuyAmount: z.string(),
    allowanceSpender: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
    transaction: z
      .object({
        to: EvmAddress.regex(/^0x[a-fA-F0-9]{40}$/),
        data: z.string(),
        value: z.string(),
      })
      .passthrough(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .passthrough();
const EvmSwapExecuteRequest = z.object({
  executionId: z.string().uuid(),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  idempotencyKey: z.string().uuid(),
});
const EvmSwapExecuteResponse = z
  .object({
    status: z.enum(["processing", "success", "failed"]),
    transactionHash: z.union([z.string(), z.null()]),
    error: z.union([z.string(), z.null()]),
  })
  .passthrough();
const SolanaSwapOrderRequest = z.object({
  inputMint: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  outputMint: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  amount: z.string().regex(/^[1-9]\d{0,19}$/),
  taker: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  idempotencyKey: z.string().uuid(),
});
const SolanaSwapOrderResponse = z
  .object({
    executionId: z.string().uuid(),
    requestId: z.string(),
    transaction: z.string(),
    inputMint: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    outputMint: SolanaAddress.regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
    inAmount: z.string(),
    outAmount: z.string(),
    minimumOutputAmount: z.string(),
    slippageBps: z.number().int(),
    prioritizationFeeLamports: z.union([z.number(), z.null()]),
    router: z.union([z.string(), z.null()]),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .passthrough();
const SolanaSwapExecuteRequest = z.object({
  executionId: z.string().uuid(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  signedTransaction: z
    .string()
    .min(4)
    .max(1644)
    .regex(
      /^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/
    ),
  idempotencyKey: z.string().uuid(),
});
const SolanaSwapExecuteResponse = z
  .object({
    status: z.enum(["processing", "success", "failed"]),
    signature: z.union([z.string(), z.null()]),
    error: z.union([z.string(), z.null()]),
  })
  .passthrough();

export const schemas = {
  Credentials,
  UserRole,
  PublicUser,
  AuthSession,
  ApiError,
  RefreshSession,
  ChangePassword,
  PasswordChangeResult,
  AdminUser,
  PaginatedUsers,
  assignUserRole_Body,
  updateUserStatus_Body,
  HealthStatus,
  AuditLogPage,
  ExecutionControl,
  ExecutionControlUpdate,
  EvmQuoteProvider,
  AggregatorControl,
  AggregatorControlUpdate,
  EvmAddress,
  EvmAllowanceDiscoveryRequest,
  EvmAllowanceDiscoveryResponse,
  CrossChainPortfolioRequest,
  WalletBalance,
  CrossChainPortfolioResponse,
  EvmPortfolioPricesRequest,
  PortfolioPricesResponse,
  SolanaAddress,
  SolanaPortfolioPricesRequest,
  RiskLevel,
  EvmTokenScreeningResponse,
  SolanaTokenScreeningResponse,
  SolanaMarketSearchResponse,
  SwapQuoteRequest,
  SwapQuoteResponse,
  BridgeQuoteRequest,
  BridgeQuoteResponse,
  PerpetualRiskCheckRequest,
  PerpetualRiskCheckResponse,
  EvmSwapOrderRequest,
  EvmSwapOrderResponse,
  EvmSwapExecuteRequest,
  EvmSwapExecuteResponse,
  SolanaSwapOrderRequest,
  SolanaSwapOrderResponse,
  SolanaSwapExecuteRequest,
  SolanaSwapExecuteResponse,
};

const endpoints = makeApi([
  {
    method: "get",
    path: "/admin/aggregator-controls/evm-quotes",
    alias: "getEvmQuoteControl",
    requestFormat: "json",
    response: AggregatorControl,
  },
  {
    method: "patch",
    path: "/admin/aggregator-controls/evm-quotes",
    alias: "updateEvmQuoteControl",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: AggregatorControlUpdate,
      },
    ],
    response: AggregatorControl,
  },
  {
    method: "get",
    path: "/admin/audit-logs",
    alias: "listAuditLogs",
    requestFormat: "json",
    parameters: [
      {
        name: "limit",
        type: "Query",
        schema: z.number().int().gte(1).lte(100).optional().default(50),
      },
      {
        name: "cursor",
        type: "Query",
        schema: z.string().uuid().optional(),
      },
      {
        name: "actorId",
        type: "Query",
        schema: z.string().uuid().optional(),
      },
      {
        name: "action",
        type: "Query",
        schema: z.string().min(1).max(120).optional(),
      },
    ],
    response: z.object({}).partial().passthrough(),
  },
  {
    method: "get",
    path: "/admin/financial-controls/execution",
    alias: "getExecutionControl",
    requestFormat: "json",
    response: ExecutionControl,
  },
  {
    method: "patch",
    path: "/admin/financial-controls/execution",
    alias: "updateExecutionControl",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: ExecutionControlUpdate,
      },
    ],
    response: ExecutionControl,
  },
  {
    method: "post",
    path: "/auth/login",
    alias: "login",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: Credentials,
      },
    ],
    response: AuthSession,
    errors: [
      {
        status: 401,
        description: `Authentication required or invalid.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "post",
    path: "/auth/logout",
    alias: "logout",
    requestFormat: "json",
    response: z.void(),
  },
  {
    method: "get",
    path: "/auth/me",
    alias: "getCurrentUser",
    requestFormat: "json",
    response: PublicUser,
  },
  {
    method: "patch",
    path: "/auth/password",
    alias: "changePassword",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: ChangePassword,
      },
    ],
    response: PasswordChangeResult,
    errors: [
      {
        status: 400,
        description: `Request validation failed.`,
        schema: ApiError,
      },
      {
        status: 401,
        description: `Authentication required or invalid.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "post",
    path: "/auth/refresh",
    alias: "refreshSession",
    requestFormat: "json",
    response: AuthSession,
    errors: [
      {
        status: 401,
        description: `Authentication required or invalid.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "post",
    path: "/auth/register",
    alias: "register",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: Credentials,
      },
    ],
    response: AuthSession,
    errors: [
      {
        status: 400,
        description: `Request validation failed.`,
        schema: ApiError,
      },
      {
        status: 409,
        description: `Request conflicts with current resource state.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "get",
    path: "/auth/sessions",
    alias: "listSessions",
    requestFormat: "json",
    response: z.array(RefreshSession),
    errors: [
      {
        status: 401,
        description: `Authentication required or invalid.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "delete",
    path: "/auth/sessions/:id",
    alias: "revokeSession",
    requestFormat: "json",
    parameters: [
      {
        name: "id",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: z.void(),
    errors: [
      {
        status: 404,
        description: `Resource was not found.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "delete",
    path: "/auth/sessions/revoke-others",
    alias: "revokeOtherSessions",
    requestFormat: "json",
    response: z.object({ revokedCount: z.number().int().gte(0) }).passthrough(),
    errors: [
      {
        status: 401,
        description: `Authentication required or invalid.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "get",
    path: "/auth/users",
    alias: "listUsers",
    requestFormat: "json",
    parameters: [
      {
        name: "limit",
        type: "Query",
        schema: z.number().int().gte(1).lte(100).optional().default(50),
      },
      {
        name: "cursor",
        type: "Query",
        schema: z.string().uuid().optional(),
      },
    ],
    response: PaginatedUsers,
  },
  {
    method: "patch",
    path: "/auth/users/:id/role",
    alias: "assignUserRole",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: assignUserRole_Body,
      },
      {
        name: "id",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: AdminUser,
  },
  {
    method: "patch",
    path: "/auth/users/:id/status",
    alias: "updateUserStatus",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: updateUserStatus_Body,
      },
      {
        name: "id",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: AdminUser,
  },
  {
    method: "post",
    path: "/bridges/quote",
    alias: "getBridgeQuote",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: BridgeQuoteRequest,
      },
    ],
    response: BridgeQuoteResponse,
  },
  {
    method: "get",
    path: "/health/live",
    alias: "getLiveness",
    requestFormat: "json",
    response: HealthStatus,
  },
  {
    method: "get",
    path: "/health/ready",
    alias: "getReadiness",
    requestFormat: "json",
    response: HealthStatus,
    errors: [
      {
        status: 503,
        description: `A required dependency is unavailable.`,
        schema: ApiError,
      },
    ],
  },
  {
    method: "post",
    path: "/perpetuals/risk-check",
    alias: "checkPerpetualRisk",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: PerpetualRiskCheckRequest,
      },
    ],
    response: PerpetualRiskCheckResponse,
  },
  {
    method: "post",
    path: "/portfolio/aggregate",
    alias: "aggregatePortfolio",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: CrossChainPortfolioRequest,
      },
    ],
    response: CrossChainPortfolioResponse,
  },
  {
    method: "post",
    path: "/portfolio/evm-allowances/discover",
    alias: "discoverEvmAllowances",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: EvmAllowanceDiscoveryRequest,
      },
    ],
    response: EvmAllowanceDiscoveryResponse,
  },
  {
    method: "post",
    path: "/portfolio/evm-prices",
    alias: "getEvmPortfolioPrices",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: EvmPortfolioPricesRequest,
      },
    ],
    response: PortfolioPricesResponse,
  },
  {
    method: "post",
    path: "/portfolio/solana-prices",
    alias: "getSolanaPortfolioPrices",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: SolanaPortfolioPricesRequest,
      },
    ],
    response: PortfolioPricesResponse,
  },
  {
    method: "get",
    path: "/solana-market/search",
    alias: "searchSolanaMarket",
    requestFormat: "json",
    parameters: [
      {
        name: "query",
        type: "Query",
        schema: z.string().min(1).max(128),
      },
    ],
    response: SolanaMarketSearchResponse,
  },
  {
    method: "get",
    path: "/swaps/evm/:executionId",
    alias: "getEvmSwapStatus",
    requestFormat: "json",
    parameters: [
      {
        name: "executionId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: EvmSwapExecuteResponse,
  },
  {
    method: "post",
    path: "/swaps/evm/execute",
    alias: "submitEvmSwap",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: EvmSwapExecuteRequest,
      },
    ],
    response: EvmSwapExecuteResponse,
  },
  {
    method: "post",
    path: "/swaps/evm/order",
    alias: "createEvmSwapOrder",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: EvmSwapOrderRequest,
      },
    ],
    response: EvmSwapOrderResponse,
  },
  {
    method: "post",
    path: "/swaps/quote",
    alias: "getSwapQuote",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: SwapQuoteRequest,
      },
    ],
    response: SwapQuoteResponse,
  },
  {
    method: "get",
    path: "/swaps/solana/:executionId",
    alias: "getSolanaSwapStatus",
    requestFormat: "json",
    parameters: [
      {
        name: "executionId",
        type: "Path",
        schema: z.string().uuid(),
      },
    ],
    response: SolanaSwapExecuteResponse,
  },
  {
    method: "post",
    path: "/swaps/solana/execute",
    alias: "submitSolanaSwap",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: SolanaSwapExecuteRequest,
      },
    ],
    response: SolanaSwapExecuteResponse,
  },
  {
    method: "post",
    path: "/swaps/solana/order",
    alias: "createSolanaSwapOrder",
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: SolanaSwapOrderRequest,
      },
    ],
    response: SolanaSwapOrderResponse,
  },
  {
    method: "get",
    path: "/token-screening/evm",
    alias: "screenEvmToken",
    requestFormat: "json",
    parameters: [
      {
        name: "chainId",
        type: "Query",
        schema: z.enum(["1", "10", "56", "137", "8453", "42161", "43114"]),
      },
      {
        name: "tokenAddress",
        type: "Query",
        schema: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      },
    ],
    response: EvmTokenScreeningResponse,
  },
  {
    method: "get",
    path: "/token-screening/solana",
    alias: "screenSolanaToken",
    requestFormat: "json",
    parameters: [
      {
        name: "mint",
        type: "Query",
        schema: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
      },
    ],
    response: SolanaTokenScreeningResponse,
  },
]);

export const api = new Zodios(endpoints);

export function createApiClient(baseUrl: string, options?: ZodiosOptions) {
  return new Zodios(baseUrl, endpoints, options);
}
