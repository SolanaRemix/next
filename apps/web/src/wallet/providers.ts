import type { NativeTransferRequest, TransferReceipt, WalletAccount, WalletBalance } from "@next/types";

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;

export function parseTokenAmount(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Unsupported token precision.");
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount.trim())) {
    throw new Error("Enter a valid positive amount.");
  }
  const [whole = "", fractional = ""] = amount.trim().split(".");
  if (fractional.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fractional + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (units <= 0n) throw new Error("Transfer amount must be greater than zero.");
  return units;
}

function getEvmProvider(): Eip1193Provider {
  const provider = typeof window === "undefined" ? undefined : window.ethereum;
  if (!provider) throw new Error("No EVM wallet detected. Install a compatible wallet and try again.");
  return provider;
}

function parseHexQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("Wallet returned an invalid balance.");
  }
  return BigInt(value);
}

function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export async function connectEvmWallet(): Promise<WalletAccount> {
  const provider = getEvmProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const chainId = await provider.request({ method: "eth_chainId" });
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address !== "string" || !evmAddressPattern.test(address)) {
    throw new Error("Wallet did not return a valid EVM account.");
  }
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
    throw new Error("Wallet returned an invalid chain identifier.");
  }
  return { address, chain: "evm", chainId, connectedAt: new Date().toISOString() };
}

export async function connectSolanaWallet(): Promise<WalletAccount> {
  const solana = await import("./solanaProviders");
  return solana.connectSolanaWallet();
}

export async function disconnectWallet(chain: WalletAccount["chain"]): Promise<void> {
  if (chain === "solana") {
    const solana = await import("./solanaProviders");
    await solana.disconnectSolanaWallet();
  }
}

export async function fetchNativeBalance(account: WalletAccount): Promise<WalletBalance> {
  if (account.chain === "evm") {
    const provider = getEvmProvider();
    const chainId = await provider.request({ method: "eth_chainId" });
    if (chainId !== account.chainId) throw new Error("Switch your wallet to the connected chain before refreshing.");
    const value = await provider.request({
      method: "eth_getBalance",
      params: [account.address, "latest"],
    });
    return {
      address: account.address,
      chain: account.chain,
      asset: "ETH",
      amount: formatUnits(parseHexQuantity(value), 18),
      decimals: 18,
    };
  }
  const solana = await import("./solanaProviders");
  return solana.fetchSolanaNativeBalance(account);
}

export async function sendNativeTransfer(
  account: WalletAccount,
  request: NativeTransferRequest,
): Promise<TransferReceipt> {
  if (account.chain !== request.chain) throw new Error("Transfer chain does not match the connected wallet.");
  if (!Number.isFinite(Number(request.amount)) || Number(request.amount) <= 0) {
    throw new Error("Enter a valid positive transfer amount.");
  }

  if (request.chain === "evm") {
    if (!evmAddressPattern.test(request.to)) throw new Error("Enter a valid destination EVM address.");
    if (request.chainId && request.chainId !== account.chainId) {
      throw new Error("The selected chain does not match the connected wallet.");
    }
    const provider = getEvmProvider();
    const [activeChainId, activeAccounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (activeChainId !== account.chainId) throw new Error("Switch your wallet to the connected chain before sending.");
    if (!Array.isArray(activeAccounts) || !activeAccounts.some(
      (address) => typeof address === "string" && address.toLowerCase() === account.address.toLowerCase(),
    )) {
      throw new Error("The connected account changed. Reconnect your wallet before sending.");
    }
    const tx = {
      from: account.address,
      to: request.to,
      value: `0x${parseTokenAmount(request.amount, 18).toString(16)}`,
    };
    const gas = await provider.request({ method: "eth_estimateGas", params: [tx] });
    const gasLimit = parseHexQuantity(gas);
    const transactionId = await provider.request({
      method: "eth_sendTransaction",
      params: [{ ...tx, gas: `0x${gasLimit.toString(16)}` }],
    });
    if (typeof transactionId !== "string" || !/^0x[0-9a-f]{64}$/i.test(transactionId)) {
      throw new Error("Wallet returned an invalid transaction identifier.");
    }
    return { chain: "evm", transactionId, status: "submitted" };
  }

  const solana = await import("./solanaProviders");
  return solana.sendSolanaNativeTransfer(account, request);
}
