import type { Context, MiddlewareHandler } from "hono";
import { verifyMessage } from "viem";

export type AuthEnv = { Variables: { wallet: string } };

function base64UrlDecode(data: string): string {
  const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

interface JwtHeader {
  alg: string;
  typ: string;
}

interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

function decodeJwt(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  signature: string;
  signingInput: string;
} {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT: expected 3 parts");
  }
  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  const header = JSON.parse(base64UrlDecode(headerB64)) as JwtHeader;
  const payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;
  const signature = base64UrlDecode(signatureB64);

  return {
    header,
    payload,
    signature,
    signingInput: `${headerB64}.${payloadB64}`,
  };
}

function isExpired(payload: JwtPayload): boolean {
  return Math.floor(Date.now() / 1000) >= payload.exp;
}

function unauthorized(c: Context, message: string): Response {
  return c.json({ error: message }, 401);
}

export const authMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorized(c, "Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);

  let decoded: ReturnType<typeof decodeJwt>;
  try {
    decoded = decodeJwt(token);
  } catch {
    return unauthorized(c, "Malformed JWT");
  }

  if (decoded.header.alg !== "EIP191") {
    return unauthorized(c, "Unsupported algorithm");
  }

  if (isExpired(decoded.payload)) {
    return unauthorized(c, "Token expired");
  }

  let valid: boolean;
  try {
    valid = await verifyMessage({
      address: decoded.payload.sub as `0x${string}`,
      message: decoded.signingInput,
      signature: decoded.signature as `0x${string}`,
    });
  } catch {
    return unauthorized(c, "Signature verification failed");
  }

  if (!valid) {
    return unauthorized(c, "Invalid signature");
  }

  c.set("wallet", decoded.payload.sub);
  await next();
};
