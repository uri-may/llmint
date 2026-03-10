import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { signJwt, decodeJwt, isExpired } from "./jwt.js";

const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("jwt", () => {
  const account = privateKeyToAccount(TEST_KEY);

  it("signs and decodes a JWT", async () => {
    const token = await signJwt(account, 3600);
    const { header, payload } = decodeJwt(token);

    expect(header.alg).toBe("EIP191");
    expect(header.typ).toBe("JWT");
    expect(payload.sub).toBe(account.address);
    expect(payload.exp).toBe(payload.iat + 3600);
  });

  it("produces 3-part token", async () => {
    const token = await signJwt(account);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("detects expired token", async () => {
    const token = await signJwt(account, 1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2000);

    const { payload } = decodeJwt(token);
    expect(isExpired(payload)).toBe(true);

    vi.useRealTimers();
  });

  it("detects valid token", async () => {
    const token = await signJwt(account, 3600);
    const { payload } = decodeJwt(token);
    expect(isExpired(payload)).toBe(false);
  });

  it("throws on malformed token", () => {
    expect(() => decodeJwt("not.a")).toThrow("Invalid JWT");
    expect(() => decodeJwt("just-a-string")).toThrow("Invalid JWT");
  });

  it("signature is deterministic for same input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const token1 = await signJwt(account, 3600);
    const token2 = await signJwt(account, 3600);
    expect(token1).toBe(token2);

    vi.useRealTimers();
  });
});
