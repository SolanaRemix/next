import type { WalletAccount } from "@next/types";

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;

function storageKey(account: WalletAccount): string {
  return `mega-gods-token-watchlist-v1:${account.chain}:${account.chainId}:${account.address.toLowerCase()}`;
}

export function loadEvmTokenWatchlist(account: WalletAccount): string[] {
  if (account.chain !== "evm") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(account));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const addresses = parsed.filter(
      (address): address is string => typeof address === "string" && evmAddressPattern.test(address),
    );
    return [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 50);
  } catch {
    return [];
  }
}

export function addEvmTokenToWatchlist(account: WalletAccount, value: string): string[] {
  if (account.chain !== "evm") throw new Error("Connect an EVM wallet before adding an ERC-20 token.");
  const address = value.trim();
  if (!evmAddressPattern.test(address)) throw new Error("Enter a valid ERC-20 token contract address.");
  const addresses = loadEvmTokenWatchlist(account);
  const normalizedAddress = address.toLowerCase();
  if (addresses.includes(normalizedAddress)) return addresses;
  if (addresses.length >= 50) throw new Error("A maximum of 50 token contracts can be tracked per account and network.");
  const next = [...addresses, normalizedAddress];
  try {
    window.localStorage.setItem(storageKey(account), JSON.stringify(next));
  } catch {
    throw new Error("Unable to save the token watchlist in this browser.");
  }
  return next;
}

export function removeEvmTokenFromWatchlist(account: WalletAccount, tokenAddress: string): string[] {
  if (account.chain !== "evm") throw new Error("Connect an EVM wallet before editing the ERC-20 watchlist.");
  const normalizedAddress = tokenAddress.toLowerCase();
  const next = loadEvmTokenWatchlist(account).filter((address) => address !== normalizedAddress);
  try {
    window.localStorage.setItem(storageKey(account), JSON.stringify(next));
  } catch {
    throw new Error("Unable to update the token watchlist in this browser.");
  }
  return next;
}
