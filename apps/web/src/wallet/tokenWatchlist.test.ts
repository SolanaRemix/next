import { afterEach, describe, expect, it } from "vitest";
import type { WalletAccount } from "@next/types";
import {
  addEvmTokenToWatchlist,
  loadEvmTokenWatchlist,
  removeEvmTokenFromWatchlist,
} from "./tokenWatchlist";

const account: WalletAccount = {
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm",
  chainId: "0x1",
  connectedAt: "2026-10-09T00:00:00.000Z",
};

afterEach(() => window.localStorage.clear());

describe("account-scoped EVM token watchlist", () => {
  it("persists valid token contract addresses without duplicates", () => {
    expect(addEvmTokenToWatchlist(account, "0x2222222222222222222222222222222222222222"))
      .toEqual(["0x2222222222222222222222222222222222222222"]);
    expect(addEvmTokenToWatchlist(account, "0x2222222222222222222222222222222222222222"))
      .toHaveLength(1);
    expect(loadEvmTokenWatchlist(account)).toEqual(["0x2222222222222222222222222222222222222222"]);
  });

  it("isolates watchlists by account and network and rejects invalid contracts", () => {
    addEvmTokenToWatchlist(account, "0x2222222222222222222222222222222222222222");
    expect(loadEvmTokenWatchlist({ ...account, chainId: "0xa" })).toEqual([]);
    expect(loadEvmTokenWatchlist({
      ...account,
      address: "0x3333333333333333333333333333333333333333",
    })).toEqual([]);
    expect(() => addEvmTokenToWatchlist(account, "not-an-address")).toThrow(/valid ERC-20 token/i);
  });

  it("ignores malformed saved entries and removes selected contracts", () => {
    window.localStorage.setItem(
      "mega-gods-token-watchlist-v1:evm:0x1:0x1111111111111111111111111111111111111111",
      JSON.stringify(["invalid", "0x2222222222222222222222222222222222222222"]),
    );
    expect(loadEvmTokenWatchlist(account)).toEqual(["0x2222222222222222222222222222222222222222"]);
    expect(removeEvmTokenFromWatchlist(account, "0x2222222222222222222222222222222222222222")).toEqual([]);
  });
});
