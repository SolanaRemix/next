import { afterEach, describe, expect, it } from "vitest";
import type { WalletAccount } from "@next/types";
import {
  addTrackedAllowance,
  loadTrackedAllowances,
  removeTrackedAllowance,
} from "./allowanceWatchlist";

const account: WalletAccount = {
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm",
  chainId: "0x1",
  connectedAt: "2026-10-09T00:00:00.000Z",
};

afterEach(() => window.localStorage.clear());

describe("account-scoped allowance watchlist", () => {
  it("stores validated token and spender pairs without duplicates", () => {
    const entry = {
      tokenAddress: "0x2222222222222222222222222222222222222222",
      spender: "0x3333333333333333333333333333333333333333",
    };
    expect(addTrackedAllowance(account, entry.tokenAddress, entry.spender)).toEqual([entry]);
    expect(addTrackedAllowance(account, entry.tokenAddress.toUpperCase().replace("0X", "0x"), entry.spender))
      .toEqual([entry]);
    expect(loadTrackedAllowances(account)).toEqual([entry]);
  });

  it("isolates tracked spenders by account and chain and rejects malformed addresses", () => {
    addTrackedAllowance(
      account,
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    );
    expect(loadTrackedAllowances({ ...account, chainId: "0xa" })).toEqual([]);
    expect(loadTrackedAllowances({
      ...account,
      address: "0x4444444444444444444444444444444444444444",
    })).toEqual([]);
    expect(() => addTrackedAllowance(account, "bad", "0x3333333333333333333333333333333333333333"))
      .toThrow(/valid token contract and spender/i);
  });

  it("removes selected token and spender pairs", () => {
    const entry = {
      tokenAddress: "0x2222222222222222222222222222222222222222",
      spender: "0x3333333333333333333333333333333333333333",
    };
    addTrackedAllowance(account, entry.tokenAddress, entry.spender);
    expect(removeTrackedAllowance(account, entry)).toEqual([]);
  });
});
