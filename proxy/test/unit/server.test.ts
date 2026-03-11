import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { serve } from "@hono/node-server";

import { createServer } from "../../src/server.js";
import type { ChainClient } from "../../src/settlement/chain.js";
import { startMockProvider } from "../fixtures/mock-provider.js";

const PLATFORM_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const USER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ED25519_KEY = "a".repeat(64);
const ADMIN_API_KEY = "test-admin-key";
const MOCK_PORT = 19001;
const SERVER_PORT = 19002;

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
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function createMockChainClient(): ChainClient {
  const locked = new Map<string, bigint>();
  const nonces = new Map<string, bigint>();
  const settlements: Array<{
    user: Address;
    totalCost: bigint;
    callCount: number;
    merkleRoot: `0x${string}`;
    chainHash: `0x${string}`;
    arweaveTxId: `0x${string}`;
  }> = [];

  return {
    async lockSession(user: Address, amount: bigint): Promise<void> {
      locked.set(user.toLowerCase(), amount);
    },
    async settle(
      user: Address,
      totalCost: bigint,
      callCount: number,
      merkleRoot: `0x${string}`,
      chainHash: `0x${string}`,
      arweaveTxId: `0x${string}`,
    ): Promise<void> {
      locked.delete(user.toLowerCase());
      const key = user.toLowerCase();
      nonces.set(key, (nonces.get(key) ?? 0n) + 1n);
      settlements.push({ user, totalCost, callCount, merkleRoot, chainHash, arweaveTxId });
    },
    async availableOf(_user: Address): Promise<bigint> {
      return 100_000000n;
    },
    async lockedOf(user: Address): Promise<bigint> {
      return locked.get(user.toLowerCase()) ?? 0n;
    },
    async sessionNonces(user: Address): Promise<bigint> {
      return nonces.get(user.toLowerCase()) ?? 0n;
    },
    async settlements(_user: Address, _nonce: bigint) {
      const s = settlements[Number(_nonce)];
      if (!s) {
        return {
          merkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
          chainHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
          totalCost: 0n,
          callCount: 0n,
          timestamp: 0n,
          arweaveTxId: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        };
      }
      return {
        merkleRoot: s.merkleRoot,
        chainHash: s.chainHash,
        totalCost: s.totalCost,
        callCount: BigInt(s.callCount),
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        arweaveTxId: s.arweaveTxId,
      };
    },
  };
}

function createMockArweaveStore() {
  const store = new Map<string, Uint8Array[]>();
  return {
    async upload(leaves: Uint8Array[]): Promise<string> {
      const id = `mock-tx-${store.size}`;
      store.set(id, leaves);
      return id.padEnd(64, "0");
    },
    async fetch(txId: string): Promise<Uint8Array[]> {
      return store.get(txId) ?? [];
    },
  };
}

let mockProviderServer: Server;
let proxyServer: ReturnType<typeof serve>;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

beforeAll(async () => {
  mockProviderServer = await startMockProvider(MOCK_PORT);

  const config = {
    port: SERVER_PORT,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    vaultAddress: "0x0000000000000000000000000000000000000001" as Address,
    usdcAddress: "0x0000000000000000000000000000000000000002" as Address,
    platformPrivateKey: PLATFORM_KEY,
    ed25519PrivateKey: ED25519_KEY,
    adminApiKey: ADMIN_API_KEY,
    upstreamUrl: `http://127.0.0.1:${MOCK_PORT}`,
    upstreamApiKey: "mock-key",
    defaultLockAmount: "50.0",
    inputTokenPrice: "0.000003",
    outputTokenPrice: "0.000015",
    maxTokensDefault: 4096,
  };

  const chainClient = createMockChainClient();
  const arweaveStore = createMockArweaveStore();
  const { app } = createServer({ config, chainClient, arweaveStore });
  proxyServer = serve({ fetch: app.fetch, port: SERVER_PORT });
}, 10000);

afterAll(() => {
  proxyServer?.close();
  mockProviderServer?.close();
});

describe("server: health", () => {
  it("returns ok", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });
});

describe("server: auth", () => {
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
});

describe("server: non-streaming chat completions", () => {
  it("returns response with attestation headers", async () => {
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
});

describe("server: streaming chat completions", () => {
  it("streams SSE with attestation event", async () => {
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
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    expect(fullText).toContain("data: ");
    expect(fullText).toContain("[DONE]");
    expect(fullText).toContain("event: attestation");

    const attestationLine = fullText
      .split("\n")
      .find(
        (line) =>
          line.startsWith("data: {") && line.includes('"attestation"'),
      );
    expect(attestationLine).toBeTruthy();

    const eventData = JSON.parse(
      attestationLine!.replace("data: ", ""),
    ) as Record<string, unknown>;
    expect(eventData["attestation"]).toBeDefined();
    expect(eventData["signature"]).toBeDefined();
  });
});

describe("server: settlement", () => {
  it("settles a session via admin endpoint", async () => {
    const account = privateKeyToAccount(USER_KEY);
    const token = await signJwt(USER_KEY);

    await fetch(`${BASE_URL}/v1/chat/completions`, {
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

    const settleRes = await fetch(
      `${BASE_URL}/admin/settle/${account.address}`,
      {
        method: "POST",
        headers: { "X-Admin-Api-Key": ADMIN_API_KEY },
      },
    );

    expect(settleRes.status).toBe(200);
    const body = (await settleRes.json()) as Record<string, unknown>;
    expect(body["settled"]).toBe(true);
    expect(body["callCount"]).toBeGreaterThan(0);
    expect(body["merkleRoot"]).toBeTruthy();
  });
});

describe("server: admin", () => {
  it("lists sessions", async () => {
    const res = await fetch(`${BASE_URL}/admin/sessions`, {
      headers: { "X-Admin-Api-Key": ADMIN_API_KEY },
    });
    expect(res.status).toBe(200);
    const sessions = (await res.json()) as unknown[];
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("rejects without API key", async () => {
    const res = await fetch(`${BASE_URL}/admin/sessions`);
    expect(res.status).toBe(401);
  });
});

describe("server: headroom", () => {
  it("returns 402 when max_tokens exceeds budget", async () => {
    const tinyKey =
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
    const token = await signJwt(tinyKey);

    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 999999999,
      }),
    });

    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    const error = body["error"] as Record<string, unknown>;
    expect(error["type"]).toBe("insufficient_funds");
  });
});
