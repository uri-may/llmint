import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...m));

export function loadSigningKey(hexPrivateKey: string): Uint8Array {
  const key = hexToBytes(hexPrivateKey);
  if (key.length !== 32) {
    throw new Error(
      `Invalid private key length: expected 32 bytes, got ${key.length}`
    );
  }
  return key;
}

export function getPublicKeyHex(privateKey: Uint8Array): string {
  return bytesToHex(ed.getPublicKey(privateKey));
}

export function sign(
  data: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  return ed.sign(data, privateKey);
}

export function verify(
  signature: Uint8Array,
  data: Uint8Array,
  publicKey: Uint8Array
): boolean {
  return ed.verify(signature, data, publicKey);
}
