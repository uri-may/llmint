import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import type { ChainClientLike } from "../../src/session/manager.js";
import { SessionManager } from "../../src/session/manager.js";

const WALLET: Address = "0xAbC1230000000000000000000000000000000001";
const DEFAULT_LOCK = 100n;

function mockChainClient(
  available = 500n,
  nonce = 1n,
): ChainClientLike {
  return {
    availableOf: async () => available,
    lockedOf: async () => 0n,
    lockSession: async () => {},
    sessionNonces: async () => nonce,
  };
}

describe("SessionManager", () => {
  it("getOrCreate creates session and locks on chain", async () => {
    const manager = new SessionManager();
    const client = mockChainClient();
    const session = await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);

    expect(session.wallet).toBe(WALLET);
    expect(session.nonce).toBe(1);
    expect(session.callCount).toBe(0);
    expect(session.totalCost).toBe(0n);
    expect(session.lockAmount).toBe(DEFAULT_LOCK);
    expect(session.chainHash).toEqual(new Uint8Array(32));
    expect(session.attestationHashes).toEqual([]);
  });

  it("getOrCreate returns existing session on second call", async () => {
    const manager = new SessionManager();
    const client = mockChainClient();
    const first = await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);
    const second = await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);

    expect(second).toBe(first);
  });

  it("getOrCreate locks min(available, defaultLockAmount)", async () => {
    const manager = new SessionManager();
    const client = mockChainClient(50n);
    const session = await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);

    expect(session.lockAmount).toBe(50n);
  });

  it("getOrCreate throws when available balance is 0", async () => {
    const manager = new SessionManager();
    const client = mockChainClient(0n);

    await expect(
      manager.getOrCreate(WALLET, client, DEFAULT_LOCK),
    ).rejects.toThrow("No available balance");
  });

  it("update increments callCount and totalCost", async () => {
    const manager = new SessionManager();
    const client = mockChainClient();
    await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);

    const hash1 = new Uint8Array([1, 2, 3]);
    const chain1 = new Uint8Array([4, 5, 6]);
    manager.update(WALLET, 10n, hash1, chain1);

    const session = manager.get(WALLET);
    expect(session?.callCount).toBe(1);
    expect(session?.totalCost).toBe(10n);
    expect(session?.chainHash).toBe(chain1);
    expect(session?.attestationHashes).toEqual([hash1]);

    const hash2 = new Uint8Array([7, 8, 9]);
    const chain2 = new Uint8Array([10, 11, 12]);
    manager.update(WALLET, 20n, hash2, chain2);

    expect(session?.callCount).toBe(2);
    expect(session?.totalCost).toBe(30n);
    expect(session?.chainHash).toBe(chain2);
    expect(session?.attestationHashes).toEqual([hash1, hash2]);
  });

  it("update throws for unknown wallet", () => {
    const manager = new SessionManager();
    const unknownWallet: Address =
      "0x0000000000000000000000000000000000000099";

    expect(() =>
      manager.update(
        unknownWallet,
        10n,
        new Uint8Array(32),
        new Uint8Array(32),
      ),
    ).toThrow("No session for");
  });

  it("remove deletes session", async () => {
    const manager = new SessionManager();
    const client = mockChainClient();
    await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);

    const removed = manager.remove(WALLET);
    expect(removed?.wallet).toBe(WALLET);
    expect(manager.get(WALLET)).toBeUndefined();
  });

  it("remove returns undefined for unknown wallet", () => {
    const manager = new SessionManager();
    const unknownWallet: Address =
      "0x0000000000000000000000000000000000000099";

    expect(manager.remove(unknownWallet)).toBeUndefined();
  });

  it("getAll returns all sessions", async () => {
    const manager = new SessionManager();
    const client = mockChainClient();
    const wallet2: Address =
      "0xDeF4560000000000000000000000000000000002";

    await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);
    await manager.getOrCreate(wallet2, client, DEFAULT_LOCK);

    const all = manager.getAll();
    expect(all).toHaveLength(2);

    const wallets = all.map((s) => s.wallet);
    expect(wallets).toContain(WALLET);
    expect(wallets).toContain(wallet2);
  });

  it("get is case-insensitive on wallet address", async () => {
    const manager = new SessionManager();
    const client = mockChainClient();
    await manager.getOrCreate(WALLET, client, DEFAULT_LOCK);

    const lower = WALLET.toLowerCase() as Address;
    const upper = WALLET.toUpperCase() as Address;

    expect(manager.get(lower)).toBeDefined();
    expect(manager.get(upper)).toBeDefined();
  });
});
