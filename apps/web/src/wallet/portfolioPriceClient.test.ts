import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEvmPortfolioPrices } from "./portfolioPriceClient";

const priceResponse = {
  chainId: "0x1",
  nativePriceUsd: 3_000,
  tokenPrices: [{ address: "0x2222222222222222222222222222222222222222", priceUsd: 1 }],
  source: "CoinGecko",
  asOf: "2026-10-09T00:00:00.000Z",
};
const addresses = ["0x2222222222222222222222222222222222222222"];

describe("fetchEvmPortfolioPrices", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests authenticated prices and validates returned chain and token addresses", async () => {
    const fetch = vi.fn(async () => Response.json(priceResponse));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchEvmPortfolioPrices("0x1", addresses, "access-token")).resolves.toEqual(priceResponse);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/portfolio\/evm-prices$/);
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>).authorization?.startsWith("Bearer ")).toBe(true);
    expect(JSON.parse(String(options.body))).toEqual({ chainId: "0x1", tokenAddresses: addresses });
  });

  it("rejects malformed responses and surfaces provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ...priceResponse,
      tokenPrices: [{ address: "0x3333333333333333333333333333333333333333", priceUsd: 1 }],
    })));
    await expect(fetchEvmPortfolioPrices("0x1", addresses, "access-token"))
      .rejects.toThrow(/invalid response/i);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Portfolio pricing is not configured." }, {
      status: 503,
    })));
    await expect(fetchEvmPortfolioPrices("0x1", addresses, "access-token"))
      .rejects.toThrow(/not configured/i);
  });
});
