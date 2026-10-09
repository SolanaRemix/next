import { describe, expect, it } from "vitest";
import { amountInUsd, calculatePortfolioUsdValue } from "./portfolioValuation";

describe("portfolio USD valuation", () => {
  it("calculates native and token values while preserving zero balances", () => {
    expect(amountInUsd("0.5", 3_000)).toBe(1_500);
    expect(calculatePortfolioUsdValue("0.5", 3_000, [
      { amount: "2", priceUsd: 1.25 },
      { amount: "0", priceUsd: 99 },
    ], 2)).toBe(1_502.5);
  });

  it("omits totals when any price, balance, or tracked token result is missing", () => {
    expect(calculatePortfolioUsdValue("1", null, [], 0)).toBeNull();
    expect(calculatePortfolioUsdValue(null, 1, [], 0)).toBeNull();
    expect(calculatePortfolioUsdValue("1", 1, [{ amount: "2", priceUsd: null }], 1)).toBeNull();
    expect(calculatePortfolioUsdValue("1", 1, [], 1)).toBeNull();
    expect(amountInUsd("1e999", 1)).toBeNull();
  });
});
