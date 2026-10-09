export const USER_ROLES = ["SuperAdmin", "EnterpriseAdmin", "Trader", "Viewer", "Guest"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type WalletChain = "evm" | "solana";

export interface WalletAccount {
  address: string;
  chain: WalletChain;
  chainId: string;
  connectedAt: string;
}

export interface WalletBalance {
  address: string;
  chain: WalletChain;
  asset: string;
  amount: string;
  decimals: number;
}

export interface NativeTransferRequest {
  chain: WalletChain;
  to: string;
  amount: string;
  chainId?: string;
}

export interface TransferReceipt {
  chain: WalletChain;
  transactionId: string;
  status: "submitted";
}

export interface OnboardingProgress {
  step: number;
  completed: boolean;
  skipped: boolean;
  updatedAt: string;
  referralCode?: string;
}

export interface OnboardingPreferenceStore {
  save(progress: OnboardingProgress): Promise<void>;
  load(): Promise<OnboardingProgress | null>;
}

export type PerpetualSide = "long" | "short";
export type MarginMode = "isolated" | "cross";

export interface PerpetualRiskCheckRequest {
  side: PerpetualSide;
  marginMode: MarginMode;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  leverage: number;
  availableMargin: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface PerpetualRiskCheckResult {
  eligible: boolean;
  reason: string | null;
  notional: number;
  initialMargin: number;
  requiredMargin: number;
  estimatedLiquidationPrice: number;
  unrealizedPnlAtMark: number;
  maintenanceMarginAtMark: number;
}

export type EvmQuoteProvider = "0x" | "1inch" | "paraswap";

export interface SwapQuoteRequest {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  sellDecimals: number;
  buyDecimals: number;
  maxSlippageBps: number;
}

export interface SwapRouteQuote {
  provider: EvmQuoteProvider;
  buyAmount: string;
  minimumBuyAmount: string;
  estimatedGas?: string;
}

export interface SwapQuoteResponse {
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  maxSlippageBps: number;
  routes: SwapRouteQuote[];
  unavailableProviders: EvmQuoteProvider[];
  quotedAt: string;
}

export interface SolanaSwapOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  idempotencyKey: string;
}

export interface SolanaSwapOrderResponse {
  executionId: string;
  requestId: string;
  transaction: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minimumOutputAmount: string;
  slippageBps: number;
  prioritizationFeeLamports: number | null;
  router: string | null;
  expiresAt: string;
}

export interface SolanaSwapExecuteRequest {
  executionId: string;
  requestId: string;
  signedTransaction: string;
  idempotencyKey: string;
}

export interface SolanaSwapExecuteResponse {
  status: "processing" | "success" | "failed";
  signature: string | null;
  error: string | null;
}

export interface SolanaMarketToken {
  mint: string;
  name: string;
  symbol: string;
  decimals: number | null;
  logoUri: string | null;
  priceUsd: number | null;
  marketSpreadBps: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  venues: string[];
  priceSource: "Jupiter" | "DEX Screener" | null;
}

export interface SolanaMarketSearchResponse {
  query: string;
  tokens: SolanaMarketToken[];
  unavailableProviders: Array<"Jupiter" | "DEX Screener">;
  asOf: string;
}
