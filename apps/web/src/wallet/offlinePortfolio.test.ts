import { afterEach, describe, expect, it } from "vitest";
import type { PortfolioPricesResponse, WalletAccount, WalletBalance } from "@next/types";
import { loadLatestOfflinePortfolio, saveOfflinePortfolio } from "./offlinePortfolio";

const account: WalletAccount = {
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm",
  chainId: "0x1",
  connectedAt: "2026-10-09T10:00:00.000Z",
};
const balances: WalletBalance[] = [{
  address: account.address,
  chain: "evm",
  asset: "ETH",
  amount: "1.25",
  decimals: 18,
  kind: "native",
}];
const prices: PortfolioPricesResponse = {
  chainId: "0x1",
  nativePriceUsd: 2_500,
  tokenPrices: [],
  source: "CoinGecko",
  asOf: "2026-10-09T10:00:00.000Z",
};

afterEach(() => window.localStorage.clear());

describe("offline portfolio snapshots", () => {
  it("saves the latest validated snapshot for offline viewing", () => {
    const saved = saveOfflinePortfolio(account, balances, 0, prices, "2026-10-09T10:01:00.000Z");

    expect(saved).toMatchObject({
      account: { address: account.address, chain: "evm", chainId: "0x1" },
      balances,
      expectedTokenCount: 0,
      prices,
      capturedAt: "2026-10-09T10:01:00.000Z",
    });
    expect(loadLatestOfflinePortfolio()).toEqual(saved);
  });

  it("keeps snapshots isolated by account and network and bounds retention", () => {
    const secondAccount: WalletAccount = {
      ...account,
      address: "0x2222222222222222222222222222222222222222",
    };
    saveOfflinePortfolio(account, balances, 0, prices, "2026-10-09T10:01:00.000Z");
    saveOfflinePortfolio(secondAccount, balances.map((balance) => ({ ...balance, address: secondAccount.address })), 0, prices);
    saveOfflinePortfolio(account, balances, 0, prices, "2026-10-09T10:02:00.000Z");

    expect(loadLatestOfflinePortfolio()?.account.address).toBe(account.address);
    const stored = window.localStorage.getItem("next.wallet.offline-portfolios.v1");
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? "[]")).toHaveLength(2);
  });

  it("does not persist malformed balances and ignores malformed stored snapshots", () => {
    expect(saveOfflinePortfolio(account, [{ ...balances[0]!, amount: "1e6" }], 0, prices)).toBeNull();
    window.localStorage.setItem("next.wallet.offline-portfolios.v1", JSON.stringify([{
      account: { address: account.address, chain: "evm", chainId: "0x1" },
      balances: [{ ...balances[0], amount: "-1" }],
      expectedTokenCount: 0,
      prices,
      capturedAt: "invalid",
    }]));

    expect(loadLatestOfflinePortfolio()).toBeNull();
  });

  it("omits prices from another network rather than displaying mismatched estimates", () => {
    const saved = saveOfflinePortfolio(account, balances, 0, { ...prices, chainId: "0x89" });

    expect(saved?.prices).toBeNull();
  });
});
