import { afterEach, describe, expect, it } from "vitest";
import {
  loadTrackedPortfolioAccounts,
  portfolioAccountKey,
  saveTrackedPortfolioAccounts,
} from "./crossChainPortfolio";

const evmAccount = {
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm" as const,
  chainId: "0x1",
  tokenAddresses: ["0x2222222222222222222222222222222222222222"],
};
const solanaAccount = {
  address: "So11111111111111111111111111111111111111112",
  chain: "solana" as const,
  chainId: "mainnet-beta",
  tokenAddresses: [],
};

afterEach(() => window.localStorage.clear());

describe("cross-chain portfolio watchlist", () => {
  it("stores public addresses in a user-scoped local watchlist", () => {
    saveTrackedPortfolioAccounts("user-1", [evmAccount, solanaAccount]);

    expect(loadTrackedPortfolioAccounts("user-1")).toEqual([evmAccount, solanaAccount]);
    expect(loadTrackedPortfolioAccounts("user-2")).toEqual([]);
  });

  it("normalizes EVM token contracts and rejects duplicate or unsupported accounts", () => {
    const normalized = saveTrackedPortfolioAccounts("user-1", [{
      ...evmAccount,
      tokenAddresses: [evmAccount.tokenAddresses[0]!.toUpperCase().replace("0X", "0x")],
    }]);
    expect(normalized[0]?.tokenAddresses).toEqual([evmAccount.tokenAddresses[0]]);
    expect(() => saveTrackedPortfolioAccounts("user-1", [evmAccount, evmAccount]))
      .toThrow("already being tracked");
    expect(() => saveTrackedPortfolioAccounts("user-1", [{
      ...solanaAccount,
      tokenAddresses: [evmAccount.tokenAddresses[0]!],
    }])).toThrow("invalid");
  });

  it("preserves Solana base58 address case in account identity", () => {
    expect(portfolioAccountKey(solanaAccount)).not.toBe(portfolioAccountKey({
      ...solanaAccount,
      address: solanaAccount.address.toLowerCase(),
    }));
  });
});
