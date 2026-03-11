import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { buildMerkleRoot } from "../../src/settlement/merkle.js";

describe("buildMerkleRoot", () => {
  it("returns the leaf itself for a single leaf", () => {
    const leaf = sha256(new TextEncoder().encode("hello"));
    const root = buildMerkleRoot([leaf]);
    expect(bytesToHex(root)).toBe(bytesToHex(leaf));
  });

  it("computes correct root for two leaves", () => {
    const leaf1 = sha256(new TextEncoder().encode("a"));
    const leaf2 = sha256(new TextEncoder().encode("b"));

    const combined = new Uint8Array(leaf1.length + leaf2.length);
    combined.set(leaf1, 0);
    combined.set(leaf2, leaf1.length);
    const expected = sha256(combined);

    const root = buildMerkleRoot([leaf1, leaf2]);
    expect(bytesToHex(root)).toBe(bytesToHex(expected));
  });

  it("handles three leaves by duplicating the last", () => {
    const leaf1 = sha256(new TextEncoder().encode("x"));
    const leaf2 = sha256(new TextEncoder().encode("y"));
    const leaf3 = sha256(new TextEncoder().encode("z"));

    // Level 1: [hash(l1||l2), hash(l3||l3)]
    const concat12 = new Uint8Array(64);
    concat12.set(leaf1, 0);
    concat12.set(leaf2, 32);
    const h12 = sha256(concat12);

    const concat33 = new Uint8Array(64);
    concat33.set(leaf3, 0);
    concat33.set(leaf3, 32);
    const h33 = sha256(concat33);

    // Level 2: hash(h12||h33)
    const concat = new Uint8Array(64);
    concat.set(h12, 0);
    concat.set(h33, 32);
    const expected = sha256(concat);

    const root = buildMerkleRoot([leaf1, leaf2, leaf3]);
    expect(bytesToHex(root)).toBe(bytesToHex(expected));
  });

  it("computes correct root for four leaves", () => {
    const leaves = ["a", "b", "c", "d"].map((s) =>
      sha256(new TextEncoder().encode(s)),
    );

    // Level 1: [hash(l0||l1), hash(l2||l3)]
    const concat01 = new Uint8Array(64);
    concat01.set(leaves[0]!, 0);
    concat01.set(leaves[1]!, 32);
    const h01 = sha256(concat01);

    const concat23 = new Uint8Array(64);
    concat23.set(leaves[2]!, 0);
    concat23.set(leaves[3]!, 32);
    const h23 = sha256(concat23);

    // Level 2: hash(h01||h23)
    const concatFinal = new Uint8Array(64);
    concatFinal.set(h01, 0);
    concatFinal.set(h23, 32);
    const expected = sha256(concatFinal);

    const root = buildMerkleRoot(leaves);
    expect(bytesToHex(root)).toBe(bytesToHex(expected));
  });

  it("throws on empty leaves", () => {
    expect(() => buildMerkleRoot([])).toThrow(
      "Cannot build merkle tree from empty leaves",
    );
  });

  it("produces deterministic results", () => {
    const leaves = ["foo", "bar", "baz"].map((s) =>
      sha256(new TextEncoder().encode(s)),
    );
    const root1 = buildMerkleRoot(leaves);
    const root2 = buildMerkleRoot(leaves);
    expect(bytesToHex(root1)).toBe(bytesToHex(root2));
  });
});
