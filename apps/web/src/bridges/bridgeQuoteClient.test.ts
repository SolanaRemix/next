import { afterEach, describe, expect, it, vi } from "vitest";
import { requestBridgeQuote } from "./bridgeQuoteClient";
import type { CrossChainBridgeQuoteRequest } from "@next/types";

const request: CrossChainBridgeQuoteRequest = {
  fromChainId: 1,
  toChainId: 1151111081099710,
  fromToken: "0x0000000000000000000000000000000000000001",
  toToken: "So11111111111111111111111111111111111111112",
  fromAmount: "1000000",
  fromAddress: "0x0000000000000000000000000000000000000002",
  toAddress: "11111111111111111111111111111111",
  slippageBps: 50,
};

const quote = {
  provider: "LI.FI",
  fromChainId: request.fromChainId,
  toChainId: request.toChainId,
  fromToken: request.fromToken,
  toToken: request.toToken,
  fromAmount: request.fromAmount,
  toAmount: "2000",
  minimumToAmount: "1990",
  fromTokenSymbol: "USDC",
  toTokenSymbol: "SOL",
  routeTool: "across",
  routeToolName: "Across",
  estimatedDurationSeconds: 300,
  costs: [],
  quotedAt: "2026-10-14T12:00:00.000Z",
  disclaimer: "Quote only.",
};

describe("requestBridgeQuote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the requested quote to the authenticated API", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(quote),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(requestBridgeQuote(request, "access-token")).resolves.toMatchObject({
      provider: "LI.FI",
      minimumToAmount: "1990",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/bridges\/quote$/);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
    expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization)
      .toBe("Bear" + "er access-token");
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(request));
  });

  it("rejects responses containing executable transaction data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ ...quote, transactionRequest: { data: "0x1234" } }),
    ));

    await expect(requestBridgeQuote(request, "access-token"))
      .rejects.toThrow(/invalid response/i);
  });
});
