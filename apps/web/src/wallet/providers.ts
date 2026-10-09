import type {
  EvmSwapOrderResponse,
  NativeTransferRequest,
  TransferReceipt,
  WalletAccount,
  WalletBalance,
} from "@next/types";

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const nativeAssetSymbols: Record<number, string> = {
  1: "ETH",
  10: "ETH",
  56: "BNB",
  137: "POL",
  8453: "ETH",
  42161: "ETH",
  43114: "AVAX",
};

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
    const chainNumber = Number.parseInt(account.chainId, 16);
    const value = await provider.request({
      method: "eth_getBalance",
      params: [account.address, "latest"],
    });
    return {
      address: account.address,
      chain: account.chain,
      asset: nativeAssetSymbols[chainNumber] ?? "NATIVE",
      amount: formatUnits(parseHexQuantity(value), 18),
      decimals: 18,
    };
  }
  const solana = await import("./solanaProviders");
  return solana.fetchSolanaNativeBalance(account);
}

function decodeAbiString(value: unknown): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error("Wallet returned invalid token metadata.");
  }
  const bytes = value.slice(2).match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [];
  if (bytes.length === 32) {
    const end = bytes.findIndex((byte) => byte === 0);
    const symbol = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes.slice(0, end === -1 ? bytes.length : end)),
    );
    if (!symbol || symbol.length > 32 || /[\u0000-\u001f\u007f]/.test(symbol)) {
      throw new Error("Token returned an invalid symbol.");
    }
    return symbol;
  }
  const offset = Number(BigInt(`0x${bytes.slice(0, 32).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`));
  if (!Number.isSafeInteger(offset) || offset < 32 || offset % 32 !== 0 || offset + 32 > bytes.length) {
    throw new Error("Wallet returned invalid token metadata.");
  }
  const length = Number(BigInt(`0x${bytes.slice(offset, offset + 32).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`));
  if (!Number.isSafeInteger(length) || length < 1 || length > 32 || offset + 32 + length > bytes.length) {
    throw new Error("Token returned an invalid symbol.");
  }
  const symbol = new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(bytes.slice(offset + 32, offset + 32 + length)),
  );
  if (/[\u0000-\u001f\u007f]/.test(symbol)) throw new Error("Token returned an invalid symbol.");
  return symbol;
}

function decodeAbiUint(value: unknown, field: string, maximum: bigint): number {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`Wallet returned invalid token ${field}.`);
  }
  const decoded = BigInt(value);
  if (decoded > maximum) throw new Error(`Token returned unsupported ${field}.`);
  return Number(decoded);
}

export async function fetchEvmTokenBalances(
  account: WalletAccount,
  tokenAddresses: readonly string[],
): Promise<WalletBalance[]> {
  if (account.chain !== "evm") throw new Error("Connect an EVM wallet to read ERC-20 balances.");
  if (tokenAddresses.length > 50 || tokenAddresses.some((address) => !evmAddressPattern.test(address))) {
    throw new Error("Track at most 50 valid ERC-20 token contracts per account and network.");
  }
  const provider = getEvmProvider();
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (chainId !== account.chainId || !Array.isArray(accounts) || !accounts.some(
    (address) => typeof address === "string" && address.toLowerCase() === account.address.toLowerCase(),
  )) {
    throw new Error("The connected EVM account or network changed. Reconnect before refreshing.");
  }
  const uniqueAddresses = [...new Set(tokenAddresses.map((address) => address.toLowerCase()))];
  const balances = await Promise.all(uniqueAddresses.map(async (tokenAddress) => {
    const [symbolResult, decimalsResult, balanceResult] = await Promise.all([
      provider.request({ method: "eth_call", params: [{ to: tokenAddress, data: "0x95d89b41" }, "latest"] }),
      provider.request({ method: "eth_call", params: [{ to: tokenAddress, data: "0x313ce567" }, "latest"] }),
      provider.request({
        method: "eth_call",
        params: [{
          to: tokenAddress,
          data: `0x70a08231${account.address.slice(2).toLowerCase().padStart(64, "0")}`,
        }, "latest"],
      }),
    ]);
    const symbol = decodeAbiString(symbolResult);
    const decimals = decodeAbiUint(decimalsResult, "decimals", 36n);
    const balanceUnits = parseHexQuantity(balanceResult);
    return {
      address: account.address,
      chain: "evm",
      asset: symbol,
      amount: formatUnits(balanceUnits, decimals),
      decimals,
      tokenAddress,
      kind: "token",
    } satisfies WalletBalance;
  }));
  const [finalChainId, finalAccounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (finalChainId !== account.chainId || !Array.isArray(finalAccounts) || !finalAccounts.some(
    (address) => typeof address === "string" && address.toLowerCase() === account.address.toLowerCase(),
  )) {
    throw new Error("The connected EVM account or network changed. Reconnect before refreshing.");
  }
  return balances;
}

export async function fetchPortfolioBalances(
  account: WalletAccount,
  tokenAddresses: readonly string[] = [],
): Promise<WalletBalance[]> {
  const native = await fetchNativeBalance(account);
  const nativeBalance: WalletBalance = { ...native, kind: "native" };
  if (account.chain === "evm") {
    return [nativeBalance, ...await fetchEvmTokenBalances(account, tokenAddresses)];
  }
  const solana = await import("./solanaProviders");
  return [nativeBalance, ...await solana.fetchSolanaTokenBalances(account)];
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

export async function executeEvmSwap(
  account: WalletAccount,
  order: EvmSwapOrderResponse,
  onSwapSubmitted: (transactionHash: string) => void,
): Promise<string> {
  if (account.chain !== "evm" || Number.parseInt(account.chainId, 16) !== order.chainId) {
    throw new Error("Connect the EVM wallet to the swap's selected network.");
  }
  if (
    account.address.toLowerCase() !== order.taker.toLowerCase() ||
    !evmAddressPattern.test(order.sellToken) ||
    !evmAddressPattern.test(order.allowanceSpender) ||
    !evmAddressPattern.test(order.transaction.to) ||
    !/^0x(?:[a-fA-F0-9]{2})+$/.test(order.transaction.data) ||
    !/^(?:0|[1-9]\d{0,77})$/.test(order.transaction.value) ||
    !/^[1-9]\d{0,77}$/.test(order.sellAmount)
  ) {
    throw new Error("Swap order contains invalid transaction details.");
  }
  const provider = getEvmProvider();

  async function assertCurrentWallet(): Promise<void> {
    const [chainId, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (chainId !== account.chainId || !Array.isArray(accounts) || !accounts.some(
      (address) => typeof address === "string" && address.toLowerCase() === account.address.toLowerCase(),
    )) {
      throw new Error("The connected EVM account or network changed. Reconnect before trading.");
    }
  }

  async function waitForReceipt(transactionHash: string): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [transactionHash],
      });
      if (receipt && typeof receipt === "object" && "status" in receipt) {
        const status = (receipt as { status?: unknown }).status;
        if (status !== "0x1" && status !== "0x0") {
          throw new Error("Wallet returned an invalid transaction receipt.");
        }
        if (status === "0x0") throw new Error("An EVM swap transaction reverted on-chain.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error("Timed out waiting for EVM transaction confirmation.");
  }

  async function sendTransaction(
    transaction: Record<string, string>,
    waitForConfirmation = true,
    onSubmitted?: (transactionHash: string) => void,
  ): Promise<string> {
    await assertCurrentWallet();
    const gas = await provider.request({ method: "eth_estimateGas", params: [transaction] });
    const gasLimit = parseHexQuantity(gas);
    const result = await provider.request({
      method: "eth_sendTransaction",
      params: [{ ...transaction, gas: `0x${gasLimit.toString(16)}` }],
    });
    if (typeof result !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(result)) {
      throw new Error("Wallet returned an invalid transaction identifier.");
    }
    onSubmitted?.(result);
    if (waitForConfirmation) await waitForReceipt(result);
    return result;
  }

  await assertCurrentWallet();
  async function readAllowance(): Promise<bigint> {
    const allowanceCallData = "0xdd62ed3e" +
      account.address.slice(2).toLowerCase().padStart(64, "0") +
      order.allowanceSpender.slice(2).toLowerCase().padStart(64, "0");
    const result = await provider.request({
      method: "eth_call",
      params: [{ to: order.sellToken, data: allowanceCallData }, "latest"],
    });
    return parseHexQuantity(result);
  }

  const allowance = await readAllowance();
  const sellAmount = BigInt(order.sellAmount);
  if (allowance < sellAmount) {
    if (allowance > 0n) {
      await sendTransaction({
        from: account.address,
        to: order.sellToken,
        value: "0x0",
        data: "0x095ea7b3" +
          order.allowanceSpender.slice(2).toLowerCase().padStart(64, "0") +
          "0".repeat(64),
      });
    }
    await sendTransaction({
      from: account.address,
      to: order.sellToken,
      value: "0x0",
      data: "0x095ea7b3" +
        order.allowanceSpender.slice(2).toLowerCase().padStart(64, "0") +
        sellAmount.toString(16).padStart(64, "0"),
    });
    if (await readAllowance() < sellAmount) {
      throw new Error("Token approval did not grant the required exact-input allowance.");
    }
  }

  if (Date.parse(order.expiresAt) <= Date.now()) {
    throw new Error("Swap order expired during token approval. Request a fresh order.");
  }
  return sendTransaction({
    from: account.address,
    to: order.transaction.to,
    data: order.transaction.data,
    value: `0x${BigInt(order.transaction.value).toString(16)}`,
  }, false, onSwapSubmitted);
}

export async function signSolanaSwapTransaction(
  account: WalletAccount,
  encodedTransaction: string,
): Promise<string> {
  if (account.chain !== "solana") {
    throw new Error("Connect a Solana wallet before signing a Solana swap.");
  }
  const solana = await import("./solanaProviders");
  return solana.signSolanaVersionedTransaction(account, encodedTransaction);
}
