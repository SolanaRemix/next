import { describe, expect, it, vi } from "vitest";
import { connectEvmWallet, parseTokenAmount } from "./providers";

const { onSolanaModuleLoad } = vi.hoisted(() => ({ onSolanaModuleLoad: vi.fn() }));

vi.mock("./solanaProviders", () => {
  onSolanaModuleLoad();
  return {};
});

describe("parseTokenAmount", () => {
  it("converts decimal token units without floating point arithmetic", () => {
    expect(parseTokenAmount("1.000000000000000001", 18)).toBe(1000000000000000001n);
    expect(parseTokenAmount("0.025", 9)).toBe(25000000n);
  });

  it("rejects zero, negative, exponent, and over-precision values", () => {
    for (const value of ["0", "-1", "1e-3", "1.0000000001"]) {
      expect(() => parseTokenAmount(value, 9)).toThrow();
    }
  });

  it("does not load Solana Web3 when connecting an EVM wallet", async () => {
    const previousProvider = window.ethereum;
    delete window.ethereum;
    await expect(connectEvmWallet()).rejects.toThrow(/No EVM wallet detected/);
    expect(onSolanaModuleLoad).not.toHaveBeenCalled();
    if (previousProvider) window.ethereum = previousProvider;
  });
});
