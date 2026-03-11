import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

import {
  loadSigningKey,
  getPublicKeyHex,
  sign,
  verify,
} from "../../src/attestation/signer.js";
import {
  canonicalJson,
  buildAttestation,
} from "../../src/attestation/builder.js";

const TEST_PRIVATE_KEY_HEX =
  "a".repeat(64);

describe("canonicalJson", () => {
  it("sorts keys deterministically", () => {
    const a = canonicalJson({ z: 1, a: 2, m: 3 });
    const b = canonicalJson({ m: 3, z: 1, a: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"m":3,"z":1}');
  });

  it("handles nested objects", () => {
    const result = canonicalJson({
      b: { d: 1, c: 2 },
      a: [3, { f: 4, e: 5 }],
    });
    expect(result).toBe(
      '{"a":[3,{"e":5,"f":4}],"b":{"c":2,"d":1}}'
    );
  });

  it("handles primitives", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(true)).toBe("true");
  });

  it("preserves array order", () => {
    const result = canonicalJson([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });
});

describe("signer", () => {
  it("loads a valid 32-byte key", () => {
    const key = loadSigningKey(TEST_PRIVATE_KEY_HEX);
    expect(key.length).toBe(32);
  });

  it("rejects invalid key length", () => {
    expect(() => loadSigningKey("aabb")).toThrow(
      "Invalid private key length"
    );
  });

  it("derives public key from private key", () => {
    const key = loadSigningKey(TEST_PRIVATE_KEY_HEX);
    const pubHex = getPublicKeyHex(key);
    expect(pubHex).toHaveLength(64);
  });

  it("sign and verify round-trip", () => {
    const privateKey = loadSigningKey(TEST_PRIVATE_KEY_HEX);
    const publicKey = hexToBytes(getPublicKeyHex(privateKey));
    const message = new TextEncoder().encode("test message");

    const signature = sign(message, privateKey);
    expect(signature.length).toBe(64);

    const valid = verify(signature, message, publicKey);
    expect(valid).toBe(true);
  });

  it("verify rejects tampered message", () => {
    const privateKey = loadSigningKey(TEST_PRIVATE_KEY_HEX);
    const publicKey = hexToBytes(getPublicKeyHex(privateKey));
    const message = new TextEncoder().encode("original");
    const tampered = new TextEncoder().encode("tampered");

    const signature = sign(message, privateKey);
    const valid = verify(signature, tampered, publicKey);
    expect(valid).toBe(false);
  });
});

describe("buildAttestation", () => {
  const privateKey = loadSigningKey(TEST_PRIVATE_KEY_HEX);
  const prevChainHash = new Uint8Array(32);

  const baseParams = {
    request: { model: "gpt-4", messages: [{ role: "user", content: "hi" }] },
    response: { choices: [{ message: { content: "hello" } }] },
    model: "gpt-4",
    inputTokens: 10,
    outputTokens: 20,
    cost: 0n,
    nonce: 1,
    callIndex: 1,
    prevChainHash,
    privateKey,
    inputTokenPrice: 5000n,
    outputTokenPrice: 15000n,
    timestamp: 1700000000,
  };

  it("produces valid attestation with verifiable signature", () => {
    const result = buildAttestation(baseParams);
    const publicKey = hexToBytes(getPublicKeyHex(privateKey));

    expect(result.attestation.model).toBe("gpt-4");
    expect(result.attestation.inputTokens).toBe(10);
    expect(result.attestation.outputTokens).toBe(20);
    expect(result.attestation.nonce).toBe(1);
    expect(result.attestation.callIndex).toBe(1);

    const expectedCost = (10n * 5000n + 20n * 15000n).toString();
    expect(result.attestation.cost).toBe(expectedCost);

    const valid = verify(
      result.signature,
      result.attestationHash,
      publicKey
    );
    expect(valid).toBe(true);
  });

  it("produces deterministic attestation hash for same inputs", () => {
    const a = buildAttestation(baseParams);
    const b = buildAttestation(baseParams);
    expect(bytesToHex(a.attestationHash)).toBe(
      bytesToHex(b.attestationHash)
    );
  });

  it("chain hash links sequential attestations", () => {
    const first = buildAttestation(baseParams);

    const second = buildAttestation({
      ...baseParams,
      callIndex: 2,
      prevChainHash: first.chainHash,
    });

    expect(second.attestation.chainHash).not.toBe(
      first.attestation.chainHash
    );

    const secondWithDifferentPrev = buildAttestation({
      ...baseParams,
      callIndex: 2,
      prevChainHash: new Uint8Array(32).fill(0xff),
    });

    expect(secondWithDifferentPrev.attestation.chainHash).not.toBe(
      second.attestation.chainHash
    );

    expect(bytesToHex(second.chainHash)).toBe(
      second.attestation.chainHash
    );
  });

  it("request and response hashes are hex-encoded SHA-256", () => {
    const result = buildAttestation(baseParams);
    expect(result.attestation.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.attestation.responseHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

