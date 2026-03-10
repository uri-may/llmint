import type { Account } from "viem";

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(data: string): string {
  const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString();
}

export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

export async function signJwt(
  account: Account,
  expiresInSeconds: number = 365 * 24 * 60 * 60,
): Promise<string> {
  if (!account.signMessage) {
    throw new Error("Account does not support signMessage");
  }

  const header = base64UrlEncode(
    JSON.stringify({ alg: "EIP191", typ: "JWT" }),
  );

  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: account.address,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));

  const signingInput = `${header}.${payloadEncoded}`;
  const signature = await account.signMessage({ message: signingInput });
  const signatureEncoded = base64UrlEncode(signature);

  return `${signingInput}.${signatureEncoded}`;
}

export function decodeJwt(token: string): {
  header: { alg: string; typ: string };
  payload: JwtPayload;
  signature: string;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT: expected 3 parts");
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  return {
    header: JSON.parse(base64UrlDecode(headerPart)),
    payload: JSON.parse(base64UrlDecode(payloadPart)),
    signature: base64UrlDecode(signaturePart),
  };
}

export function isExpired(payload: JwtPayload): boolean {
  return Math.floor(Date.now() / 1000) >= payload.exp;
}
