import { describe, expect, it } from "vitest";
import { parseTokenAmount } from "./providers";

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
});
