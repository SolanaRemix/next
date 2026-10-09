import { afterEach, describe, expect, it, vi } from "vitest";
import { searchSolanaMarket } from "./solanaMarketClient";

const token = {
  mint: "So11111111111111111111111111111111111111112",
  name: "Solana",
  symbol: "SOL",
  decimals: 9,
  logoUri: "https://cdn.example/sol.png",
  priceUsd: 150,
  marketSpreadBps: 12,
  liquidityUsd: 100_000,
  volume24hUsd: 50_000,
  venues: ["orca", "raydium"],
  priceSource: "Jupiter",
};

describe("searchSolanaMarket", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates and returns authenticated live-market responses", async () => {
    const fetch = vi.fn(async () => Response.json({
      query: "SOL",
      tokens: [token],
      unavailableProviders: [],
      asOf: "2026-10-09T00:00:00.000Z",
    }));
    vi.stubGlobal("fetch", fetch);

    const response = await searchSolanaMarket("SOL", "access-token");

    expect(response.tokens[0]?.symbol).toBe("SOL");
    const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("query")).toBe("SOL");
    expect(options.headers).toHaveProperty("authorization");
  });

  it("rejects invalid responses and propagates abort signals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ tokens: [] })));
    await expect(searchSolanaMarket("SOL", "access-token"))
      .rejects.toThrow(/invalid response/i);

    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }));
    await expect(searchSolanaMarket("SOL", "access-token", controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });
});
