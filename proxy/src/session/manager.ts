import type { Address } from "viem";
import type { SessionState } from "./types.js";

export interface ChainClientLike {
  availableOf(user: Address): Promise<bigint>;
  lockedOf(user: Address): Promise<bigint>;
  lockSession(user: Address, amount: bigint): Promise<void>;
  sessionNonces(user: Address): Promise<bigint>;
}

export class SessionManager {
  private sessions = new Map<string, SessionState>();

  async getOrCreate(
    wallet: Address,
    chainClient: ChainClientLike,
    defaultLockAmount: bigint,
  ): Promise<SessionState> {
    const key = wallet.toLowerCase();
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const available = await chainClient.availableOf(wallet);
    if (available === 0n) {
      throw new Error(`No available balance for ${wallet}`);
    }

    const lockAmount =
      available < defaultLockAmount ? available : defaultLockAmount;
    await chainClient.lockSession(wallet, lockAmount);

    const nonce = await chainClient.sessionNonces(wallet);

    const session: SessionState = {
      wallet,
      nonce: Number(nonce),
      callCount: 0,
      totalCost: 0n,
      lockAmount,
      chainHash: new Uint8Array(32),
      attestationHashes: [],
    };

    this.sessions.set(key, session);
    return session;
  }

  get(wallet: Address): SessionState | undefined {
    return this.sessions.get(wallet.toLowerCase());
  }

  update(
    wallet: Address,
    cost: bigint,
    attestationHash: Uint8Array,
    chainHash: Uint8Array,
  ): void {
    const session = this.sessions.get(wallet.toLowerCase());
    if (!session) throw new Error(`No session for ${wallet}`);
    session.callCount += 1;
    session.totalCost += cost;
    session.chainHash = chainHash;
    session.attestationHashes.push(attestationHash);
  }

  checkHeadroom(wallet: Address, worstCaseCost: bigint): boolean {
    const session = this.sessions.get(wallet.toLowerCase());
    if (!session) return false;
    return session.totalCost + worstCaseCost <= session.lockAmount;
  }

  remove(wallet: Address): SessionState | undefined {
    const key = wallet.toLowerCase();
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    return session;
  }

  getAll(): SessionState[] {
    return [...this.sessions.values()];
  }
}
