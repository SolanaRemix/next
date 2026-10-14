import type { PortfolioPricesResponse, WalletAccount, WalletBalance } from "@next/types";

const storageKey = "next.wallet.offline-portfolios.v1";
const maxSnapshots = 5;
const maxBalances = 51;

export interface OfflinePortfolioSnapshot {
  account: Pick<WalletAccount, "address" | "chain" | "chainId">;
  balances: WalletBalance[];
  expectedTokenCount: number;
  prices: PortfolioPricesResponse | null;
  capturedAt: string;
}

function validBalance(value: unknown): value is WalletBalance {
  if (typeof value !== "object" || value === null) return false;
  const balance = value as Record<string, unknown>;
  return typeof balance.address === "string" && balance.address.length <= 128
    && (balance.chain === "evm" || balance.chain === "solana")
    && typeof balance.asset === "string" && balance.asset.length <= 32
    && typeof balance.amount === "string" && /^\d+(?:\.\d+)?$/.test(balance.amount)
    && balance.amount.length <= 100
    && typeof balance.decimals === "number" && Number.isInteger(balance.decimals)
    && balance.decimals >= 0 && balance.decimals <= 36
    && (balance.tokenAddress === undefined
      || (typeof balance.tokenAddress === "string" && balance.tokenAddress.length <= 128))
    && (balance.kind === undefined || balance.kind === "native" || balance.kind === "token");
}

function validPrices(value: unknown): value is PortfolioPricesResponse {
  if (typeof value !== "object" || value === null) return false;
  const prices = value as Record<string, unknown>;
  if (typeof prices.chainId !== "string" || prices.chainId.length > 32
    || (prices.nativePriceUsd !== null
      && (typeof prices.nativePriceUsd !== "number" || !Number.isFinite(prices.nativePriceUsd) || prices.nativePriceUsd < 0))
    || prices.source !== "CoinGecko"
    || typeof prices.asOf !== "string"
    || !Number.isFinite(Date.parse(prices.asOf))
    || !Array.isArray(prices.tokenPrices)
    || prices.tokenPrices.length > maxBalances - 1) return false;

  return prices.tokenPrices.every((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return false;
    const tokenPrice = entry as Record<string, unknown>;
    return typeof tokenPrice.address === "string" && tokenPrice.address.length <= 128
      && (tokenPrice.priceUsd === null
        || (typeof tokenPrice.priceUsd === "number"
          && Number.isFinite(tokenPrice.priceUsd) && tokenPrice.priceUsd >= 0));
  });
}

function validSnapshot(value: unknown): value is OfflinePortfolioSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  const account = snapshot.account;
  if (typeof account !== "object" || account === null) return false;
  const wallet = account as Record<string, unknown>;
  if (!(typeof wallet.address === "string" && wallet.address.length <= 128
    && (wallet.chain === "evm" || wallet.chain === "solana")
    && typeof wallet.chainId === "string" && wallet.chainId.length <= 32
    && Array.isArray(snapshot.balances) && snapshot.balances.length > 0
    && snapshot.balances.length <= maxBalances
    && snapshot.balances.every(validBalance)
    && (snapshot.balances[0] as WalletBalance).kind !== "token"
    && typeof snapshot.expectedTokenCount === "number"
    && Number.isInteger(snapshot.expectedTokenCount)
    && snapshot.expectedTokenCount >= 0 && snapshot.expectedTokenCount <= maxBalances - 1
    && (snapshot.prices === null || validPrices(snapshot.prices))
    && typeof snapshot.capturedAt === "string"
    && Number.isFinite(Date.parse(snapshot.capturedAt)))) return false;

  const sameAddress = wallet.chain === "evm"
    ? (address: string): boolean => address.toLowerCase() === (wallet.address as string).toLowerCase()
    : (address: string): boolean => address === wallet.address;
  const balances = snapshot.balances as WalletBalance[];
  return balances.every((balance) => balance.chain === wallet.chain && sameAddress(balance.address))
    && balances.slice(1).every((balance) => balance.kind === "token" && balance.tokenAddress !== undefined)
    && (snapshot.prices === null
      || (snapshot.prices as PortfolioPricesResponse).chainId.toLowerCase()
        === (wallet.chainId as string).toLowerCase());
}

function accountKey(account: Pick<WalletAccount, "address" | "chain" | "chainId">): string {
  return `${account.chain}:${account.chainId.toLowerCase()}:${account.address.toLowerCase()}`;
}

function readSnapshots(): OfflinePortfolioSnapshot[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw || raw.length > 512_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validSnapshot).slice(0, maxSnapshots);
  } catch {
    return [];
  }
}

export function loadLatestOfflinePortfolio(): OfflinePortfolioSnapshot | null {
  return readSnapshots()[0] ?? null;
}

export function saveOfflinePortfolio(
  account: WalletAccount,
  balances: readonly WalletBalance[],
  expectedTokenCount: number,
  prices: PortfolioPricesResponse | null,
  capturedAt = new Date().toISOString(),
): OfflinePortfolioSnapshot | null {
  if (balances.length === 0 || balances.length > maxBalances || !balances.every(validBalance)
    || !Number.isInteger(expectedTokenCount) || expectedTokenCount < 0 || expectedTokenCount > maxBalances - 1) return null;
  const accountSummary = { address: account.address, chain: account.chain, chainId: account.chainId };
  const snapshot: OfflinePortfolioSnapshot = {
    account: accountSummary,
    balances: [...balances],
    expectedTokenCount,
    prices: prices && validPrices(prices) && prices.chainId.toLowerCase() === account.chainId.toLowerCase()
      ? prices
      : null,
    capturedAt,
  };
  try {
    const others = readSnapshots().filter((entry) => accountKey(entry.account) !== accountKey(accountSummary));
    window.localStorage.setItem(storageKey, JSON.stringify([snapshot, ...others].slice(0, maxSnapshots)));
    return snapshot;
  } catch {
    return null;
  }
}
