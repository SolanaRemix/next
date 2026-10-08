import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSwapQuote } from "./swapClient";

describe("requestSwapQuote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends quotes to the backend and parses the safe quote response", async () => {
    const payload = {
      chainId: 1,
      sellToken: "0x0000000000000000000000000000000000000001",
      buyToken: "0x0000000000000000000000000000000000000002",
      sellAmount: "1000000",
      maxSlippageBps: 50,
      routes: [{ provider: "paraswap", buyAmount: "1000", minimumBuyAmount: "995" }],
      unavailableProviders: ["0x", "1inch"],
      quotedAt: "2026-10-08T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(payload),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestSwapQuote({
      chainId: 1,
      sellToken: payload.sellToken,
      buyToken: payload.buyToken,
      sellAmount: "1000000",
      sellDecimals: 6,
      buyDecimals: 18,
      maxSlippageBps: 50,
    });

    expect(result.routes[0]?.provider).toBe("paraswap");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/swaps\/quote$/);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("rejects malformed successful backend responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ routes: [] })));

    await expect(requestSwapQuote({
      chainId: 1,
      sellToken: "0x0000000000000000000000000000000000000001",
      buyToken: "0x0000000000000000000000000000000000000002",
      sellAmount: "10",
      sellDecimals: 1,
      buyDecimals: 1,
      maxSlippageBps: 50,
    })).rejects.toThrow(/invalid response/i);
  });
});
