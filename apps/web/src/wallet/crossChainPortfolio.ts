import type { CrossChainPortfolioAccountRequest } from "@next/types";

const storagePrefix = "next.cross-chain-portfolio.v1.";
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const portfolioNetworks = [
  { chain: "evm", chainId: "0x1", label: "Ethereum" },
  { chain: "evm", chainId: "0xa", label: "Optimism" },
  { chain: "evm", chainId: "0x38", label: "BNB Chain" },
  { chain: "evm", chainId: "0x89", label: "Polygon" },
  { chain: "evm", chainId: "0x2105", label: "Base" },
  { chain: "evm", chainId: "0xa4b1", label: "Arbitrum" },
  { chain: "evm", chainId: "0xa86a", label: "Avalanche" },
  { chain: "solana", chainId: "mainnet-beta", label: "Solana Mainnet" },
] as const;

export type TrackedPortfolioAccount = CrossChainPortfolioAccountRequest;

function storageKey(userId: string): string {
  return `${storagePrefix}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidTrackedAccount(value: unknown): value is TrackedPortfolioAccount {
  if (!isRecord(value) || typeof value.chain !== "string" || typeof value.chainId !== "string"
    || typeof value.address !== "string" || !Array.isArray(value.tokenAddresses)
    || value.tokenAddresses.length > 50
    || !value.tokenAddresses.every((address) => typeof address === "string" && evmAddressPattern.test(address))) {
    return false;
  }
  const network = portfolioNetworks.find(({ chain, chainId }) => (
    chain === value.chain && chainId === value.chainId
  ));
  if (!network) return false;
  if (value.chain === "evm") return evmAddressPattern.test(value.address);
  return solanaAddressPattern.test(value.address) && value.tokenAddresses.length === 0;
}

export function portfolioAccountKey(account: Pick<TrackedPortfolioAccount, "chain" | "chainId" | "address">): string {
  const address = account.chain === "evm" ? account.address.toLowerCase() : account.address;
  return `${account.chain}:${account.chainId.toLowerCase()}:${address}`;
}

export function loadTrackedPortfolioAccounts(userId: string): TrackedPortfolioAccount[] {
  if (typeof window === "undefined" || userId.length === 0) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw || raw.length > 32_768) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const accounts = parsed.filter(isValidTrackedAccount).slice(0, 8);
    return accounts.filter((account, index) => (
      accounts.findIndex((candidate) => portfolioAccountKey(candidate) === portfolioAccountKey(account)) === index
    ));
  } catch {
    return [];
  }
}

export function saveTrackedPortfolioAccounts(
  userId: string,
  accounts: readonly TrackedPortfolioAccount[],
): TrackedPortfolioAccount[] {
  if (typeof window === "undefined" || userId.length === 0
    || accounts.length > 8 || !accounts.every(isValidTrackedAccount)) {
    throw new Error("Portfolio account list is invalid.");
  }
  const unique = new Set(accounts.map(portfolioAccountKey));
  if (unique.size !== accounts.length) throw new Error("Portfolio account is already being tracked.");
  const saved = accounts.map((account) => ({
    address: account.address,
    chain: account.chain,
    chainId: account.chainId,
    tokenAddresses: [...new Set(account.tokenAddresses.map((address) => address.toLowerCase()))],
  }));
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(saved));
    return saved;
  } catch {
    throw new Error("Unable to save the portfolio list in this browser.");
  }
}
