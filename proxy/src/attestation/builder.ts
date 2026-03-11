import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import { sign } from "./signer.js";
import type { Attestation } from "./types.js";

export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const items = obj.map((item) => canonicalJson(item));
    return `[${items.join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => {
    const value = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJson(value)}`;
  });
  return `{${pairs.join(",")}}`;
}

export function computeHash(data: string | Uint8Array): Uint8Array {
  if (typeof data === "string") {
    return sha256(new TextEncoder().encode(data));
  }
  return sha256(data);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

export interface BuildAttestationParams {
  request: object;
  response: object;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: bigint;
  nonce: number;
  callIndex: number;
  prevChainHash: Uint8Array;
  privateKey: Uint8Array;
  inputTokenPrice: bigint;
  outputTokenPrice: bigint;
  timestamp?: number;
}

export interface BuildAttestationResult {
  attestation: Attestation;
  attestationHash: Uint8Array;
  chainHash: Uint8Array;
  signature: Uint8Array;
}

export function buildAttestation(
  params: BuildAttestationParams
): BuildAttestationResult {
  const requestHash = computeHash(canonicalJson(params.request));
  const responseHash = computeHash(canonicalJson(params.response));
  const cost =
    BigInt(params.inputTokens) * params.inputTokenPrice +
    BigInt(params.outputTokens) * params.outputTokenPrice;

  const attestation: Attestation = {
    requestHash: bytesToHex(requestHash),
    responseHash: bytesToHex(responseHash),
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cost: cost.toString(),
    nonce: params.nonce,
    callIndex: params.callIndex,
    chainHash: "",
    timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
  };

  const attestationHash = computeHash(canonicalJson(attestation));
  const chainHash = computeHash(
    concatBytes(params.prevChainHash, attestationHash)
  );
  attestation.chainHash = bytesToHex(chainHash);

  const finalAttestationHash = computeHash(canonicalJson(attestation));
  const signature = sign(finalAttestationHash, params.privateKey);

  return {
    attestation,
    attestationHash: finalAttestationHash,
    chainHash,
    signature,
  };
}
