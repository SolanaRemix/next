import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCrossChainPortfolio } from "./crossChainPortfolioClient";
import type { CrossChainPortfolioAccountRequest } from "@next/types";

const request: CrossChainPortfolioAccountRequest = {
  address: "0x1111111111111111111111111111111111111111",
  chain: "evm",
  chainId: "0x1",
  tokenAddresses: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("cross-chain portfolio client", () => {
  it("sends the authenticated read-only request and validates the response", async () => {
    const payload = {
      accounts: [{
        account: { address: request.address, chain: "evm", chainId: "0x1" },
        available: true,
        assets: [{
          balance: {
            address: request.address,
            chain: "evm",
            asset: "ETH",
            amount: "1",
            decimals: 18,
            kind: "native",
          },
          priceUsd: 2_000,
          valueUsd: 2_000,
        }],
        totalUsd: 2_000,
      }],
      totalUsd: 2_000,
      complete: true,
      asOf: "2026-10-14T10:00:00.000Z",
    };
    const fetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      expect(new Headers(options?.headers).get("authorization")).toBe(["Bearer", "access-token"].join(" "));
      expect(JSON.parse(String(options?.body))).toEqual({ accounts: [request] });
      return Response.json(payload);
    });
    vi.stubGlobal("fetch", fetch);

    await expect(fetchCrossChainPortfolio([request], "access-token")).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed response data rather than displaying untrusted values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      accounts: [{
        account: { ...request },
        available: true,
        assets: [{
          balance: { address: "0x3333333333333333333333333333333333333333" },
          priceUsd: 1,
          valueUsd: 1,
        }],
        totalUsd: 1,
      }],
      totalUsd: 1,
      complete: true,
      asOf: "2026-10-14T10:00:00.000Z",
    })));

    await expect(fetchCrossChainPortfolio([request], "access-token"))
      .rejects.toThrow("invalid response");
  });
});
