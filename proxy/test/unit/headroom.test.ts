import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import type { ChainClientLike } from "../../src/session/manager.js";
import { SessionManager } from "../../src/session/manager.js";

const WALLET: Address = "0xAbC1230000000000000000000000000000000001";

function mockChainClient(available = 100n): ChainClientLike {
  return {
    availableOf: async () => available,
    lockedOf: async () => 0n,
    lockSession: async () => {},
    sessionNonces: async () => 1n,
  };
}

describe("checkHeadroom", () => {
  it("fresh session has full headroom", async () => {
    const manager = new SessionManager();
    await manager.getOrCreate(WALLET, mockChainClient(), 100n);

    expect(manager.checkHeadroom(WALLET, 50n)).toBe(true);
    expect(manager.checkHeadroom(WALLET, 100n)).toBe(true);
  });

  it("exact budget: totalCost + worstCase === lockAmount", async () => {
    const manager = new SessionManager();
    await manager.getOrCreate(WALLET, mockChainClient(), 100n);

    manager.update(WALLET, 60n, new Uint8Array(32), new Uint8Array(32));

    expect(manager.checkHeadroom(WALLET, 40n)).toBe(true);
  });

  it("over budget: totalCost + worstCase > lockAmount", async () => {
    const manager = new SessionManager();
    await manager.getOrCreate(WALLET, mockChainClient(), 100n);

    manager.update(WALLET, 60n, new Uint8Array(32), new Uint8Array(32));

    expect(manager.checkHeadroom(WALLET, 41n)).toBe(false);
  });

  it("multiple updates reducing headroom progressively", async () => {
    const manager = new SessionManager();
    await manager.getOrCreate(WALLET, mockChainClient(), 100n);

    expect(manager.checkHeadroom(WALLET, 100n)).toBe(true);

    manager.update(WALLET, 30n, new Uint8Array(32), new Uint8Array(32));
    expect(manager.checkHeadroom(WALLET, 70n)).toBe(true);
    expect(manager.checkHeadroom(WALLET, 71n)).toBe(false);

    manager.update(WALLET, 30n, new Uint8Array(32), new Uint8Array(32));
    expect(manager.checkHeadroom(WALLET, 40n)).toBe(true);
    expect(manager.checkHeadroom(WALLET, 41n)).toBe(false);

    manager.update(WALLET, 40n, new Uint8Array(32), new Uint8Array(32));
    expect(manager.checkHeadroom(WALLET, 0n)).toBe(true);
    expect(manager.checkHeadroom(WALLET, 1n)).toBe(false);
  });

  it("returns false for unknown wallet", () => {
    const manager = new SessionManager();
    const unknownWallet: Address =
      "0x0000000000000000000000000000000000000099";

    expect(manager.checkHeadroom(unknownWallet, 10n)).toBe(false);
  });
});
