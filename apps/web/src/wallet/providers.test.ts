import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectEvmWallet,
  executeEvmSwap,
  fetchEvmTokenBalances,
  fetchNativeBalance,
  parseTokenAmount,
  readEvmTokenAllowance,
  revokeEvmTokenAllowance,
  sendNativeTransfer,
  simulateNativeTransfer,
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

describe("EVM token allowance management", () => {
  const account: WalletAccount = {
    address: "0x1111111111111111111111111111111111111111",
    chain: "evm",
    chainId: "0x1",
    connectedAt: new Date().toISOString(),
  };
  const token = "0x2222222222222222222222222222222222222222";
  const spender = "0x3333333333333333333333333333333333333333";
  const allowanceCall = "0xdd62ed3e" +
    account.address.slice(2).toLowerCase().padStart(64, "0") +
    spender.slice(2).toLowerCase().padStart(64, "0");
  const transactionHash = `0x${"a".repeat(64)}`;
  const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

  it("reads allowances only for the connected account and active network", async () => {
    const request = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [account.address];
      if (method === "eth_call") {
        expect(params?.[0]).toEqual({ to: token, data: allowanceCall });
        return word(123n);
      }
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    window.ethereum = { request };

    await expect(readEvmTokenAllowance(account, token, spender)).resolves.toBe(123n);
    expect(request.mock.calls.filter(([args]) => args.method === "eth_chainId")).toHaveLength(2);
  });

  it("simulates, estimates, wallet-submits, and confirms zero allowance before reporting revoke", async () => {
    let allowanceReads = 0;
    const request = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [account.address];
      if (method === "eth_call") {
        const transaction = params?.[0] as { to?: string; data?: string };
        if (transaction.data?.startsWith("0xdd62ed3e")) {
          allowanceReads += 1;
          return allowanceReads < 3 ? word(100n) : word(0n);
        }
        return "0x";
      }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return transactionHash;
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    window.ethereum = { request };

    await expect(revokeEvmTokenAllowance(account, token, spender)).resolves.toBe(transactionHash);
    const simulation = request.mock.calls.find(([args]) =>
      args.method === "eth_call" && (args.params?.[0] as { data?: string }).data?.startsWith("0x095ea7b3"));
    expect(simulation?.[0].params?.[0]).toMatchObject({
      from: account.address,
      to: token,
      value: "0x0",
      data: `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}`,
    });
    const sent = request.mock.calls.find(([args]) => args.method === "eth_sendTransaction");
    expect(sent?.[0].params?.[0]).toMatchObject({
      from: account.address,
      to: token,
      data: `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}`,
      gas: "0x5208",
    });
    expect(request.mock.calls.some(([args]) => args.method === "eth_getTransactionReceipt")).toBe(true);
  });

  it("fails closed without sending when simulation fails, allowance is zero, or the account changes", async () => {
    const createProvider = (allowanceResult: string, simulationFails = false, switchAccount = false) => {
      let accountReads = 0;
      return vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_accounts") {
          accountReads += 1;
          return switchAccount && accountReads > 1 ? [spender] : [account.address];
        }
        if (method === "eth_call") {
          const transaction = params?.[0] as { data?: string };
          if (transaction.data?.startsWith("0xdd62ed3e")) return allowanceResult;
          if (simulationFails) throw new Error("simulation revert");
          return "0x";
        }
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_sendTransaction") return transactionHash;
        if (method === "eth_getTransactionReceipt") return { status: "0x1" };
        throw new Error(`Unexpected wallet method: ${method}`);
      });
    };
    const zeroAllowanceRequest = createProvider(word(0n));
    window.ethereum = { request: zeroAllowanceRequest };
    await expect(revokeEvmTokenAllowance(account, token, spender)).rejects.toThrow(/already has zero allowance/i);
    expect(zeroAllowanceRequest.mock.calls.some(([args]) => args.method === "eth_sendTransaction")).toBe(false);

    const simulationRequest = createProvider(word(1n), true);
    window.ethereum = { request: simulationRequest };
    await expect(revokeEvmTokenAllowance(account, token, spender)).rejects.toThrow(/simulation revert/);
    expect(simulationRequest.mock.calls.some(([args]) => args.method === "eth_sendTransaction")).toBe(false);

    const switchedAccountRequest = createProvider(word(1n), false, true);
    window.ethereum = { request: switchedAccountRequest };
    await expect(readEvmTokenAllowance(account, token, spender)).rejects.toThrow(/account or network changed/i);
    expect(switchedAccountRequest.mock.calls.some(([args]) => args.method === "eth_call")).toBe(true);
  });
});

describe("EVM native transfer simulation", () => {
  const account: WalletAccount = {
    address: "0x1111111111111111111111111111111111111111",
    chain: "evm",
    chainId: "0x1",
    connectedAt: new Date().toISOString(),
  };
  const request = {
    chain: "evm" as const,
    to: "0x2222222222222222222222222222222222222222",
    amount: "0.1",
    chainId: "0x1",
  };
  const txHash = `0x${"c".repeat(64)}`;

  it("previews gas, checks funds, and re-simulates before wallet submission", async () => {
    const calls: string[] = [];
    const walletRequest = vi.fn(async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      void params;
      calls.push(method);
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_accounts") return [account.address];
      if (method === "eth_call") return "0x";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice") return "0x3b9aca00";
      if (method === "eth_getBalance") return "0x1bc16d674ec80000";
      if (method === "eth_sendTransaction") return txHash;
      throw new Error(`Unexpected wallet method: ${method}`);
    });
    window.ethereum = { request: walletRequest };

    await expect(simulateNativeTransfer(account, request)).resolves.toMatchObject({
      asset: "ETH",
      recipient: request.to,
      amount: "0.1",
      estimatedFee: "0.000021",
      totalEstimatedDebit: "0.100021",
    });
    expect(walletRequest.mock.calls.some(([args]) => args.method === "eth_sendTransaction")).toBe(false);

    await expect(sendNativeTransfer(account, request)).resolves.toEqual({
      chain: "evm",
      transactionId: txHash,
      status: "submitted",
    });
    const sendIndex = calls.indexOf("eth_sendTransaction");
    expect(sendIndex).toBeGreaterThan(calls.lastIndexOf("eth_call"));
    const sent = walletRequest.mock.calls.find(([args]) => args.method === "eth_sendTransaction");
    expect(sent?.[0].params?.[0]).toMatchObject({
      from: account.address,
      to: request.to,
      value: "0x16345785d8a0000",
      gas: "0x5208",
    });
  });

  it("does not send when simulation fails or estimated funds are insufficient", async () => {
    const createProvider = (simulationFails: boolean, balance: string) => vi.fn(
      async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_accounts") return [account.address];
        if (method === "eth_call") {
          if (simulationFails) throw new Error("execution reverted");
          return "0x";
        }
        if (method === "eth_estimateGas") return "0x5208";
        if (method === "eth_gasPrice") return "0x3b9aca00";
        if (method === "eth_getBalance") return balance;
        if (method === "eth_sendTransaction") return txHash;
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    );
    const reverted = createProvider(true, "0x1bc16d674ec80000");
    window.ethereum = { request: reverted };
    await expect(sendNativeTransfer(account, request)).rejects.toThrow(/execution reverted/);
    expect(reverted.mock.calls.some(([args]) => args.method === "eth_sendTransaction")).toBe(false);

    const insufficient = createProvider(false, "0x16345785d8a0000");
    window.ethereum = { request: insufficient };
    await expect(simulateNativeTransfer(account, request)).rejects.toThrow(/insufficient native balance/i);
    expect(insufficient.mock.calls.some(([args]) => args.method === "eth_sendTransaction")).toBe(false);
  });
});
