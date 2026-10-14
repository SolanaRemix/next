import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverEvmAllowances } from "./allowanceDiscoveryClient";
import type { EvmAllowanceDiscoveryRequest } from "@next/types";

const request: EvmAllowanceDiscoveryRequest = {
  chainId: "0x1",
  owner: "0x1111111111111111111111111111111111111111",
  tokenAddresses: ["0x2222222222222222222222222222222222222222"],
};

afterEach(() => vi.unstubAllGlobals());

describe("allowance discovery client", () => {
  it("sends authenticated requests and validates current allowance results", async () => {
    const result = {
      chainId: "0x1",
      owner: request.owner,
      scannedFromBlock: "100",
      scannedToBlock: "200",
      scannedBlockCount: 101,
      completeHistory: false,
      approvals: [{
        tokenAddress: request.tokenAddresses[0],
        tokenSymbol: "TOK",
        tokenDecimals: 18,
        spender: "0x3333333333333333333333333333333333333333",
        allowanceRaw: "1000000000000000000",
        allowance: "1",
        lastApprovalBlock: "150",
      }],
      asOf: "2026-10-14T10:00:00.000Z",
    };
    const fetch = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => {
      expect(new Headers(options?.headers).get("authorization")).toBe(["Bearer", "access-token"].join(" "));
      expect(JSON.parse(String(options?.body))).toEqual(request);
      return Response.json(result);
    });
    vi.stubGlobal("fetch", fetch);

    await expect(discoverEvmAllowances(request, "access-token")).resolves.toEqual(result);
  });

  it("rejects results outside requested tokens or without the incomplete-history marker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      chainId: "0x1",
      owner: request.owner,
      scannedFromBlock: "100",
      scannedToBlock: "200",
      scannedBlockCount: 101,
      completeHistory: true,
      approvals: [],
      asOf: "2026-10-14T10:00:00.000Z",
    })));

    await expect(discoverEvmAllowances(request, "access-token"))
      .rejects.toThrow("invalid response");
  });
});
