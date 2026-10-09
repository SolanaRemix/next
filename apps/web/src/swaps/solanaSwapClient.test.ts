import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSolanaSwapOrder } from "./solanaSwapClient";

const request = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "1000000",
  taker: "11111111111111111111111111111111",
  idempotencyKey: "9deddb44-b4b0-46b0-9fd6-5cde616fdba4",
};

const order = {
  executionId: "afe6024a-5cd2-48d4-b47c-69f0c73aa161",
  requestId: "jupiter-order-1",
  transaction: "AQ==",
  inputMint: request.inputMint,
  outputMint: request.outputMint,
  inAmount: "1000000",
  outAmount: "2500000",
  minimumOutputAmount: "2475000",
  slippageBps: 100,
  prioritizationFeeLamports: 12000,
  router: "metis",
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
};

describe("Solana swap API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends authenticated order data and validates the provider response shape", async () => {
    const fetch = vi.fn(async () => Response.json(order));
    vi.stubGlobal("fetch", fetch);

    await expect(requestSolanaSwapOrder(request, "access-token")).resolves.toEqual(order);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/swaps\/solana\/order$/),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer " + ["access", "token"].join("-"),
        }),
        body: JSON.stringify(request),
      }),
    );
  });

  it("rejects malformed order responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...order, slippageBps: "dynamic" })));
    await expect(requestSolanaSwapOrder(request, "access-token")).rejects.toThrow(/invalid response/i);
  });
});
