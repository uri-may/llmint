import { describe, it, expect } from "vitest";
import { parseUsdc, formatUsdc, formatUsdcTrimmed } from "./format.js";

describe("parseUsdc", () => {
  it("parses whole numbers", () => {
    expect(parseUsdc("50")).toBe(50_000_000n);
  });

  it("parses decimals", () => {
    expect(parseUsdc("10.5")).toBe(10_500_000n);
  });

  it("parses full precision", () => {
    expect(parseUsdc("1.234567")).toBe(1_234_567n);
  });

  it("truncates beyond 6 decimals", () => {
    expect(parseUsdc("1.1234569")).toBe(1_123_456n);
  });

  it("parses zero", () => {
    expect(parseUsdc("0")).toBe(0n);
  });

  it("parses small amounts", () => {
    expect(parseUsdc("0.000001")).toBe(1n);
  });
});

describe("formatUsdc", () => {
  it("formats whole amounts", () => {
    expect(formatUsdc(50_000_000n)).toBe("$50.000000");
  });

  it("formats fractional amounts", () => {
    expect(formatUsdc(10_500_000n)).toBe("$10.500000");
  });

  it("formats zero", () => {
    expect(formatUsdc(0n)).toBe("$0.000000");
  });

  it("formats small amounts", () => {
    expect(formatUsdc(1n)).toBe("$0.000001");
  });
});

describe("formatUsdcTrimmed", () => {
  it("formats whole amounts with .00", () => {
    expect(formatUsdcTrimmed(50_000_000n)).toBe("$50.00");
  });

  it("trims trailing zeros", () => {
    expect(formatUsdcTrimmed(10_500_000n)).toBe("$10.5");
  });

  it("keeps significant decimals", () => {
    expect(formatUsdcTrimmed(4_200_000n)).toBe("$4.2");
  });

  it("formats zero", () => {
    expect(formatUsdcTrimmed(0n)).toBe("$0.00");
  });

  it("formats sub-cent amounts", () => {
    expect(formatUsdcTrimmed(1n)).toBe("$0.000001");
  });
});
