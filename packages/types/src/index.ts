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
  tokenAddress?: string;
  kind?: "native" | "token";
}

export interface CrossChainPortfolioAccountRequest {
  address: string;
  chain: WalletChain;
  chainId: string;
  tokenAddresses: string[];
}

export interface CrossChainPortfolioRequest {
  accounts: CrossChainPortfolioAccountRequest[];
}

export interface CrossChainPortfolioAsset {
  balance: WalletBalance;
  priceUsd: number | null;
  valueUsd: number | null;
}

export interface CrossChainPortfolioAccountResult {
  account: Pick<CrossChainPortfolioAccountRequest, "address" | "chain" | "chainId">;
  available: boolean;
  assets: CrossChainPortfolioAsset[];
  totalUsd: number | null;
}

export interface CrossChainPortfolioResponse {
  accounts: CrossChainPortfolioAccountResult[];
  totalUsd: number | null;
  complete: boolean;
  asOf: string;
}

export interface EvmAllowanceDiscoveryRequest {
  chainId: string;
  owner: string;
  tokenAddresses: string[];
}

export interface DiscoveredEvmAllowance {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  spender: string;
  allowanceRaw: string;
  allowance: string;
  lastApprovalBlock: string;
}

export interface EvmAllowanceDiscoveryResponse {
  chainId: string;
  owner: string;
  scannedFromBlock: string;
  scannedToBlock: string;
  scannedBlockCount: number;
  completeHistory: false;
  approvals: DiscoveredEvmAllowance[];
  asOf: string;
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

export interface CrossChainBridgeQuoteRequest {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
  slippageBps: number;
}

export interface CrossChainBridgeQuoteCost {
  kind: "fee" | "gas";
  name: string;
  amount: string | null;
  tokenSymbol: string | null;
  amountUsd: string | null;
}

export interface CrossChainBridgeQuoteResponse {
  provider: "LI.FI";
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  minimumToAmount: string;
  fromTokenSymbol: string;
  toTokenSymbol: string;
  routeTool: string;
  routeToolName: string;
  estimatedDurationSeconds: number | null;
  costs: CrossChainBridgeQuoteCost[];
  quotedAt: string;
  disclaimer: string;
}

export interface EvmSwapOrderRequest extends SwapQuoteRequest {
  taker: string;
  idempotencyKey: string;
}

export interface EvmSwapOrderResponse {
  executionId: string;
  chainId: number;
  taker: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  minimumBuyAmount: string;
  allowanceSpender: string;
  transaction: {
    to: string;
    data: string;
    value: string;
  };
  expiresAt: string;
}

export interface EvmSwapExecuteRequest {
  executionId: string;
  transactionHash: string;
  idempotencyKey: string;
}

export interface EvmSwapExecuteResponse {
  status: "processing" | "success" | "failed";
  transactionHash: string | null;
  error: string | null;
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

export interface EvmPortfolioPricesRequest {
  chainId: string;
  tokenAddresses: string[];
}

export interface PortfolioPricesResponse {
  chainId: string;
  nativePriceUsd: number | null;
  tokenPrices: Array<{
    address: string;
    priceUsd: number | null;
  }>;
  source: "CoinGecko";
  asOf: string;
}

export type EvmTokenRiskLevel = "unknown" | "low" | "medium" | "high" | "critical";

export interface EvmTokenRiskSignals {
  honeypot: boolean | null;
  openSource: boolean | null;
  proxy: boolean | null;
  mintable: boolean | null;
  ownershipRecoverable: boolean | null;
  ownerCanChangeBalance: boolean | null;
  hiddenOwner: boolean | null;
  selfDestruct: boolean | null;
  externalCall: boolean | null;
  blacklisted: boolean | null;
  transferPausable: boolean | null;
  slippageModifiable: boolean | null;
  buyTaxPercent: number | null;
  sellTaxPercent: number | null;
}

export interface EvmTokenRiskScreeningResponse {
  chainId: string;
  tokenAddress: string;
  source: "GoPlus";
  riskScore: number | null;
  riskLevel: EvmTokenRiskLevel;
  observedSignals: number;
  totalSignals: number;
  signals: EvmTokenRiskSignals;
  indicators: string[];
  asOf: string;
  disclaimer: string;
}

export interface SolanaTokenRiskSignals {
  mintable: boolean | null;
  freezable: boolean | null;
  closable: boolean | null;
  balanceMutable: boolean | null;
  metadataMutable: boolean | null;
  transferFeeEnabled: boolean | null;
  transferFeeUpgradable: boolean | null;
  transferHookPresent: boolean | null;
  maliciousTransferHook: boolean | null;
  transferHookUpgradable: boolean | null;
  defaultAccountFrozen: boolean | null;
  defaultAccountStateUpgradable: boolean | null;
  nonTransferable: boolean | null;
  trustedToken: boolean | null;
}

export interface SolanaTokenRiskScreeningResponse {
  network: "solana-mainnet";
  tokenAddress: string;
  source: "GoPlus Solana beta";
  riskScore: number | null;
  riskLevel: EvmTokenRiskLevel;
  observedSignals: number;
  totalSignals: number;
  signals: SolanaTokenRiskSignals;
  indicators: string[];
  asOf: string;
  disclaimer: string;
}

export type EvmPortfolioPricesResponse = PortfolioPricesResponse;
