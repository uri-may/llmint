import { sha256 } from "@noble/hashes/sha256";

export function buildMerkleRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    throw new Error("Cannot build merkle tree from empty leaves");
  }
  if (leaves.length === 1) {
    return leaves[0]!;
  }

  let level = [...leaves];
  if (level.length % 2 !== 0) {
    level.push(level[level.length - 1]!);
  }

  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1]!;
      const combined = new Uint8Array(left.length + right.length);
      combined.set(left, 0);
      combined.set(right, left.length);
      next.push(sha256(combined));
    }
    level = next;
    if (level.length > 1 && level.length % 2 !== 0) {
      level.push(level[level.length - 1]!);
    }
  }

  return level[0]!;
}
