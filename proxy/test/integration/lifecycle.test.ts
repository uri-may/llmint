import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  setupTestEnv,
  teardownTestEnv,
  USER_KEY,
  ADMIN_API_KEY,
  PROXY_PORT,
} from "./setup.js";
import type { TestContext } from "./setup.js";

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signJwt(privateKey: `0x${string}`): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const header = base64UrlEncode(
    JSON.stringify({ alg: "EIP191", typ: "JWT" }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({ sub: account.address, iat: now, exp: now + 3600 }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await account.signMessage({ message: signingInput });
  const signatureEncoded = base64UrlEncode(signature);
  return `${signingInput}.${signatureEncoded}`;
}

const BASE_URL = `http://127.0.0.1:${PROXY_PORT}`;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestEnv();
}, 60000);

afterAll(() => {
  if (ctx) teardownTestEnv(ctx);
});

describe("integration: full lifecycle", () => {
  it("health check", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });

  it("rejects unauthenticated request", async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it("makes authenticated API call and receives attestation", async () => {
    const token = await signJwt(USER_KEY);

    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body["choices"]).toBeDefined();

    const attestHeader = res.headers.get("X-Attestation");
    const sigHeader = res.headers.get("X-Attestation-Signature");
    expect(attestHeader).toBeTruthy();
    expect(sigHeader).toBeTruthy();

    const attestation = JSON.parse(attestHeader!) as Record<string, unknown>;
    expect(attestation["model"]).toBe("gpt-4");
    expect(attestation["inputTokens"]).toBe(10);
    expect(attestation["outputTokens"]).toBe(8);
    expect(attestation["callIndex"]).toBe(1);
  });

  it("makes multiple calls and settles on-chain", async () => {
    const token = await signJwt(USER_KEY);
    const account = privateKeyToAccount(USER_KEY);

    const makeCall = async () => {
      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "test" }],
        }),
      });
      expect(res.status).toBe(200);
      return res;
    };

    await makeCall();
    await makeCall();

    const settleRes = await fetch(
      `${BASE_URL}/admin/settle/${account.address}`,
      {
        method: "POST",
        headers: { "X-Admin-Api-Key": ADMIN_API_KEY },
      },
    );

    expect(settleRes.status).toBe(200);
    const settleBody = (await settleRes.json()) as Record<string, unknown>;
    expect(settleBody["settled"]).toBe(true);
    expect(settleBody["callCount"]).toBeGreaterThan(0);
    expect(settleBody["merkleRoot"]).toBeTruthy();

    const nonce = await ctx.chainClient.sessionNonces(account.address);
    expect(nonce).toBeGreaterThan(0n);

    const settlement = await ctx.chainClient.settlements(
      account.address,
      nonce - 1n,
    );
    expect(settlement.merkleRoot).not.toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(settlement.callCount).toBeGreaterThan(0n);
  });

  it("lists active sessions via admin endpoint", async () => {
    const res = await fetch(`${BASE_URL}/admin/sessions`, {
      headers: { "X-Admin-Api-Key": ADMIN_API_KEY },
    });
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as unknown[];
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("rejects admin requests without API key", async () => {
    const res = await fetch(`${BASE_URL}/admin/sessions`);
    expect(res.status).toBe(401);
  });
});
