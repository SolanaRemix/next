import { afterEach, describe, expect, it, vi } from "vitest";
import { screenEvmToken, screenSolanaToken } from "./tokenScreeningClient";

const address = "0x2222222222222222222222222222222222222222";
const validResponse = {
  chainId: "1",
  tokenAddress: address,
  source: "GoPlus",
  riskScore: 0,
  riskLevel: "low",
  observedSignals: 14,
  totalSignals: 14,
  signals: {
    honeypot: false,
    openSource: true,
    proxy: false,
    mintable: false,
    ownershipRecoverable: false,
    ownerCanChangeBalance: false,
    hiddenOwner: false,
    selfDestruct: false,
    externalCall: false,
    blacklisted: false,
    transferPausable: false,
    slippageModifiable: false,
    buyTaxPercent: 0,
    sellTaxPercent: 0,
  },
  indicators: [],
  asOf: "2026-10-11T00:00:00.000Z",
  disclaimer: "Not a safety guarantee.",
} as const;
const solanaMint = "So11111111111111111111111111111111111111112";
const validSolanaResponse = {
  network: "solana-mainnet",
  tokenAddress: solanaMint,
  source: "GoPlus Solana beta",
  riskScore: null,
  riskLevel: "unknown",
  observedSignals: 1,
  totalSignals: 14,
  signals: {
    mintable: false,
    freezable: null,
    closable: null,
    balanceMutable: null,
    metadataMutable: null,
    transferFeeEnabled: null,
    transferFeeUpgradable: null,
    transferHookPresent: null,
    maliciousTransferHook: null,
    transferHookUpgradable: null,
    defaultAccountFrozen: null,
    defaultAccountStateUpgradable: null,
    nonTransferable: null,
    trustedToken: null,
  },
  indicators: [],
  asOf: "2026-10-11T00:00:00.000Z",
  disclaimer: "Beta data is not a safety guarantee.",
} as const;

describe("screenEvmToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests an authenticated screening and validates the API response", async () => {
    const fetch = vi.fn(async () => Response.json(validResponse));
    vi.stubGlobal("fetch", fetch);

    const result = await screenEvmToken("1", address, "access-token");
    const [input, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];

    expect(result.riskLevel).toBe("low");
    expect(input.pathname).toBe("/api/token-screening/evm");
    expect(input.searchParams.get("chainId")).toBe("1");
    expect(input.searchParams.get("tokenAddress")).toBe(address);
    expect(options.headers).toHaveProperty("authorization");
    expect((options.headers as Record<string, string>).authorization).toContain("Bearer ");
  });

  it("preserves explicit unknown assessments with incomplete data", async () => {
    const response = {
      ...validResponse,
      riskScore: null,
      riskLevel: "unknown",
      observedSignals: 2,
      signals: { ...validResponse.signals, honeypot: null, mintable: null },
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(response)));

    await expect(screenEvmToken("1", address, "access-token"))
      .resolves.toMatchObject({ riskScore: null, riskLevel: "unknown", observedSignals: 2 });
  });

  it("rejects malformed success responses and returns server errors safely", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ...validResponse,
      signals: { honeypot: "unknown" },
    })));
    await expect(screenEvmToken("1", address, "access-token"))
      .rejects.toThrow(/invalid response/i);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "Request was throttled." },
      { status: 429 },
    )));
    await expect(screenEvmToken("1", address, "access-token"))
      .rejects.toThrow("Request was throttled.");
  });

  it("normalizes network failures and preserves abort errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("transport details"); }));
    await expect(screenEvmToken("1", address, "access-token"))
      .rejects.toThrow("Token screening service is unavailable.");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("Aborted", "AbortError"); }));
    await expect(screenEvmToken("1", address, "access-token"))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("requests Solana beta screening and validates its distinct risk signal contract", async () => {
    const fetch = vi.fn(async () => Response.json(validSolanaResponse));
    vi.stubGlobal("fetch", fetch);

    const result = await screenSolanaToken(solanaMint, "access-token");
    const [input, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];

    expect(result).toMatchObject({ source: "GoPlus Solana beta", riskLevel: "unknown" });
    expect(input.pathname).toBe("/api/token-screening/solana");
    expect(input.searchParams.get("mint")).toBe(solanaMint);
    expect(options.headers).toHaveProperty("authorization");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      ...validSolanaResponse,
      signals: { mintable: "unknown" },
    })));
    await expect(screenSolanaToken(solanaMint, "access-token"))
      .rejects.toThrow(/invalid response/i);
  });
});
