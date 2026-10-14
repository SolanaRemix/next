import type { WalletAccount } from "@next/types";

export interface TrackedAllowance {
  tokenAddress: string;
  spender: string;
}

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;

function storageKey(account: WalletAccount): string {
  return `mega-gods-allowances-v1:${account.chainId}:${account.address.toLowerCase()}`;
}

function isTrackedAllowance(value: unknown): value is TrackedAllowance {
  if (!value || typeof value !== "object") return false;
  const allowance = value as Record<string, unknown>;
  return typeof allowance.tokenAddress === "string" &&
    evmAddressPattern.test(allowance.tokenAddress) &&
    typeof allowance.spender === "string" &&
    evmAddressPattern.test(allowance.spender);
}

export function loadTrackedAllowances(account: WalletAccount): TrackedAllowance[] {
  if (account.chain !== "evm") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(account));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const unique = new Map<string, TrackedAllowance>();
    for (const candidate of parsed) {
      if (!isTrackedAllowance(candidate)) continue;
      const tokenAddress = candidate.tokenAddress.toLowerCase();
      const spender = candidate.spender.toLowerCase();
      unique.set(`${tokenAddress}:${spender}`, { tokenAddress, spender });
    }
    return [...unique.values()].slice(0, 50);
  } catch {
    return [];
  }
}

export function addTrackedAllowance(
  account: WalletAccount,
  tokenAddress: string,
  spender: string,
): TrackedAllowance[] {
  if (account.chain !== "evm") throw new Error("Connect an EVM wallet before tracking allowances.");
  const token = tokenAddress.trim();
  const delegate = spender.trim();
  if (!evmAddressPattern.test(token) || !evmAddressPattern.test(delegate)) {
    throw new Error("Enter valid token contract and spender addresses.");
  }
  const current = loadTrackedAllowances(account);
  const normalizedToken = token.toLowerCase();
  const normalizedSpender = delegate.toLowerCase();
  if (current.some((entry) => entry.tokenAddress === normalizedToken && entry.spender === normalizedSpender)) {
    return current;
  }
  if (current.length >= 50) throw new Error("A maximum of 50 token and spender pairs can be tracked per account and network.");
  const next = [...current, { tokenAddress: normalizedToken, spender: normalizedSpender }];
  try {
    window.localStorage.setItem(storageKey(account), JSON.stringify(next));
  } catch {
    throw new Error("Unable to save the allowance watchlist in this browser.");
  }
  return next;
}

export function removeTrackedAllowance(
  account: WalletAccount,
  entry: TrackedAllowance,
): TrackedAllowance[] {
  if (account.chain !== "evm") throw new Error("Connect an EVM wallet before editing tracked allowances.");
  const next = loadTrackedAllowances(account).filter(
    (candidate) => candidate.tokenAddress !== entry.tokenAddress.toLowerCase() ||
      candidate.spender !== entry.spender.toLowerCase(),
  );
  try {
    window.localStorage.setItem(storageKey(account), JSON.stringify(next));
  } catch {
    throw new Error("Unable to update the allowance watchlist in this browser.");
  }
  return next;
}
