export type UserRole = "SuperAdmin" | "EnterpriseAdmin" | "Trader" | "Viewer" | "Guest";

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
