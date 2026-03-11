import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { AuthEnv } from "../../src/middleware/auth.js";
import { authMiddleware } from "../../src/middleware/auth.js";

const ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createJwt(options?: {
  exp?: number;
  tamperPayload?: boolean;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    JSON.stringify({ alg: "EIP191", typ: "JWT" }),
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: account.address,
      iat: now,
      exp: options?.exp ?? now + 3600,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signature = await account.signMessage({ message: signingInput });
  const signatureEncoded = base64UrlEncode(signature);

  if (options?.tamperPayload) {
    const tampered = base64UrlEncode(
      JSON.stringify({
        sub: account.address,
        iat: now,
        exp: now + 7200,
      }),
    );
    return `${header}.${tampered}.${signatureEncoded}`;
  }

  return `${header}.${payload}.${signatureEncoded}`;
}

function createApp(): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use("/*", authMiddleware);
  app.get("/protected", (c) => {
    return c.json({ wallet: c.get("wallet") });
  });
  return app;
}

describe("auth middleware", () => {
  it("accepts a valid JWT", async () => {
    const app = createApp();
    const token = await createJwt();
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { wallet: string };
    expect(body.wallet.toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
  });

  it("rejects an expired token", async () => {
    const app = createApp();
    const token = await createJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Token expired");
  });

  it("rejects a missing Authorization header", async () => {
    const app = createApp();
    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Missing or invalid Authorization header");
  });

  it("rejects a tampered payload", async () => {
    const app = createApp();
    const token = await createJwt({ tamperPayload: true });
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid signature");
  });
});
