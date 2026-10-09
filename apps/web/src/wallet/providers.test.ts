import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectEvmWallet,
  executeEvmSwap,
  fetchEvmTokenBalances,
  fetchNativeBalance,
  parseTokenAmount,
  readEvmTokenAllowance,
  revokeEvmTokenAllowance,
} from "./providers";
import type { EvmSwapOrderResponse, WalletAccount } from "@next/types";

const { onSolanaModuleLoad } = vi.hoisted(() => ({ onSolanaModuleLoad: vi.fn() }));

vi.mock("./solanaProviders", () => {
  onSolanaModuleLoad();
  return {};
});

afterEach(() => {
  delete window.ethereum;
});

describe("parseTokenAmount", () => {
  it("converts decimal token units without floating point arithmetic", () => {
    expect(parseTokenAmount("1.000000000000000001", 18)).toBe(1000000000000000001n);
    expect(parseTokenAmount("0.025", 9)).toBe(25000000n);
  });

  it("rejects zero, negative, exponent, and over-precision values", () => {
    for (const value of ["0", "-1", "1e-3", "1.0000000001"]) {
      expect(() => parseTokenAmount(value, 9)).toThrow();
    }
  });

  it("does not load Solana Web3 when connecting an EVM wallet", async () => {
    const previousProvider = window.ethereum;
    delete window.ethereum;
    await expect(connectEvmWallet()).rejects.toThrow(/No EVM wallet detected/);
    expect(onSolanaModuleLoad).not.toHaveBeenCalled();
    if (previousProvider) window.ethereum = previousProvider;
  });

  it("approves only the exact sell amount and submits the quoted 0x transaction", async () => {
    const account: WalletAccount = {
      address: "0x1111111111111111111111111111111111111111",
      chain: "evm",
      chainId: "0x1",
      connectedAt: new Date().toISOString(),
    };
    const order: EvmSwapOrderResponse = {
      executionId: "afe6024a-5cd2-48d4-b47c-69f0c73aa161",
      chainId: 1,
      taker: account.address,
      sellToken: "0x2222222222222222222222222222222222222222",
      buyToken: "0x3333333333333333333333333333333333333333",
      sellAmount: "100",
      buyAmount: "200",
      minimumBuyAmount: "198",
      allowanceSpender: "0x4444444444444444444444444444444444444444",
      transaction: {
        to: "0x5555555555555555555555555555555555555555",
        data: "0x12345678",
        value: "0",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const txHashes = [
      `0x${"a".repeat(64)}`,
      `0x${"b".repeat(64)}`,
    ];
    let sendIndex = 0;
    let allowanceCallIndex = 0;
    const request = vi.fn(async ({ method }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [account.address];
      if (method === "eth_call") {
        allowanceCallIndex += 1;
        return allowanceCallIndex === 1 ? `0x${"0".repeat(64)}` : "0x64";
      }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return txHashes[sendIndex++];
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    window.ethereum = { request };
    const submitted = vi.fn();

    const transactionHash = await executeEvmSwap(account, order, submitted);

    expect(transactionHash).toBe(txHashes[1]);
    expect(submitted).toHaveBeenCalledWith(txHashes[1]);
    const sent = request.mock.calls
      .filter(([args]) => args.method === "eth_sendTransaction")
      .map(([args]) => args);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.params?.[0]).toMatchObject({
      to: order.sellToken,
      data: `0x095ea7b3${order.allowanceSpender.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(62)}64`,
    });
    expect(sent[1]?.params?.[0]).toMatchObject({
      to: order.transaction.to,
      data: order.transaction.data,
      value: "0x0",
    });
  });

  it("rejects a swap if the wallet account does not match the quote taker", async () => {
    const account: WalletAccount = {
      address: "0x1111111111111111111111111111111111111111",
      chain: "evm",
      chainId: "0x1",
      connectedAt: new Date().toISOString(),
    };
    const order = {
      executionId: "afe6024a-5cd2-48d4-b47c-69f0c73aa161",
      chainId: 1,
      taker: "0x9999999999999999999999999999999999999999",
      sellToken: "0x2222222222222222222222222222222222222222",
      buyToken: "0x3333333333333333333333333333333333333333",
      sellAmount: "100",
      buyAmount: "200",
      minimumBuyAmount: "198",
      allowanceSpender: "0x4444444444444444444444444444444444444444",
      transaction: {
        to: "0x5555555555555555555555555555555555555555",
        data: "0x12345678",
        value: "0",
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } satisfies EvmSwapOrderResponse;
    const request = vi.fn();
    window.ethereum = { request };

    await expect(executeEvmSwap(account, order, vi.fn())).rejects.toThrow(/invalid transaction details/i);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("fetchNativeBalance", () => {
  it.each([
    ["0x1", "ETH"],
    ["0xa", "ETH"],
    ["0x38", "BNB"],
    ["0x89", "POL"],
    ["0x2105", "ETH"],
    ["0xa4b1", "ETH"],
    ["0xa86a", "AVAX"],
    ["0x999", "NATIVE"],
  ])("labels chain %s with its native asset %s", async (chainId, asset) => {
    window.ethereum = {
      request: vi.fn(async ({ method }) =>
        method === "eth_chainId" ? chainId : "0xde0b6b3a7640000"),
    };
    const balance = await fetchNativeBalance({
      address: "0x1111111111111111111111111111111111111111",
      chain: "evm",
      chainId,
      connectedAt: new Date().toISOString(),
    });

    expect(balance.asset).toBe(asset);
    expect(balance.amount).toBe("1");
  });
});

describe("fetchEvmTokenBalances", () => {
  const account: WalletAccount = {
    address: "0x1111111111111111111111111111111111111111",
    chain: "evm",
    chainId: "0x1",
    connectedAt: new Date().toISOString(),
  };
  const tokenAddress = "0x2222222222222222222222222222222222222222";
  const word = (value: bigint) => value.toString(16).padStart(64, "0");
  const encodedSymbol = (symbol: string) => {
    const bytes = Array.from(new TextEncoder().encode(symbol), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `0x${word(32n)}${word(BigInt(symbol.length))}${bytes.padEnd(64, "0")}`;
  };

  it("reads ERC-20 metadata and balance using read-only calls with exact formatting", async () => {
    const request = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [account.address];
      if (method === "eth_call") {
        const transaction = params?.[0] as { data?: string };
        if (transaction.data === "0x95d89b41") return encodedSymbol("USDC");
        if (transaction.data === "0x313ce567") return `0x${word(6n)}`;
        if (transaction.data?.startsWith("0x70a08231")) return `0x${word(1_234_567n)}`;
      }
      throw new Error(`Unexpected wallet method: ${method}`);
    });

    window.ethereum = { request };

    await expect(fetchEvmTokenBalances(account, [tokenAddress])).resolves.toEqual([{
      address: account.address,
      chain: "evm",
      asset: "USDC",
      amount: "1.234567",
      decimals: 6,
      tokenAddress,
      kind: "token",
    }]);
    expect(request.mock.calls.filter(([args]) => args.method === "eth_call")).toHaveLength(3);
  });

  it("preserves zero balances and supports bytes32 symbol metadata", async () => {
    const bytes32Symbol = `0x${Array.from(new TextEncoder().encode("OLD"), (byte) =>
      byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0")}`;
    window.ethereum = {
      request: vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_accounts") return [account.address];
        const transaction = params?.[0] as { data?: string };
        if (transaction.data === "0x95d89b41") return bytes32Symbol;
        if (transaction.data === "0x313ce567") return `0x${word(0n)}`;
        if (transaction.data?.startsWith("0x70a08231")) return "0x0";
        throw new Error(`Unexpected wallet method: ${method}`);
      }),
    };

    await expect(fetchEvmTokenBalances(account, [tokenAddress])).resolves.toMatchObject([
      { asset: "OLD", amount: "0", decimals: 0 },
    ]);
  });

  it("rejects invalid token addresses and detects a network switch during reads", async () => {
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === "eth_chainId" ? "0x1" : [account.address]);
    window.ethereum = { request };
    await expect(fetchEvmTokenBalances(account, ["invalid"])).rejects.toThrow(/valid ERC-20 token contracts/i);
    expect(request.mock.calls.some(([args]) => args.method === "eth_call")).toBe(false);

    let chainCalls = 0;
    window.ethereum = {
      request: vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
        if (method === "eth_chainId") return ++chainCalls === 1 ? "0x1" : "0xa";
        if (method === "eth_accounts") return [account.address];
        const transaction = params?.[0] as { data?: string };
        if (transaction.data === "0x95d89b41") return encodedSymbol("TKN");
        if (transaction.data === "0x313ce567") return `0x${word(18n)}`;
        if (transaction.data?.startsWith("0x70a08231")) return `0x${word(1n)}`;
        throw new Error(`Unexpected wallet method: ${method}`);
      }),
    };
    await expect(fetchEvmTokenBalances(account, [tokenAddress])).rejects.toThrow(/account or network changed/i);
  });
});
