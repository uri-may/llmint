import type { Address } from "viem";

export interface SessionState {
  wallet: Address;
  nonce: number;
  callCount: number;
  totalCost: bigint;
  lockAmount: bigint;
  chainHash: Uint8Array;
  attestationHashes: Uint8Array[];
}
