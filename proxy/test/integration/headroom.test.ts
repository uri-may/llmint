import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
  erc20Abi,
} from "viem";
import type { Address } from "viem";
import { foundry } from "viem/chains";

import {
  setupTestEnv,
  teardownTestEnv,
  PROXY_PORT,
} from "./setup.js";
import type { TestContext } from "./setup.js";

const TINY_USER_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

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

async function depositSmallAmount(
  userKey: `0x${string}`,
  amount: bigint,
  vaultAddress: Address,
  usdcAddress: Address,
): Promise<void> {
  const account = privateKeyToAccount(userKey);
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  });
  const walletClient = createWalletClient({
    account,
    chain: foundry,
    transport: http("http://127.0.0.1:8545"),
  });

  const usdc = getContract({
    address: usdcAddress,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  const approveHash = await usdc.write.approve([vaultAddress, amount]);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const vault = getContract({
    address: vaultAddress,
    abi: [
      {
        type: "function",
        name: "deposit",
        inputs: [{ name: "amount", type: "uint256" }],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ] as const,
    client: { public: publicClient, wallet: walletClient },
  });

  const depositHash = await vault.write.deposit([amount]);
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
}

const BASE_URL = `http://127.0.0.1:${PROXY_PORT}`;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestEnv();
  await depositSmallAmount(
    TINY_USER_KEY,
    100n,
    ctx.vaultAddress,
    ctx.usdcAddress,
  );
}, 60000);

afterAll(() => {
  if (ctx) teardownTestEnv(ctx);
});

describe("integration: headroom exhaustion", () => {
  it("returns 402 when balance is insufficient for request", async () => {
    const token = await signJwt(TINY_USER_KEY);

    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 100000,
      }),
    });

    expect(res.status).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    const error = body["error"] as Record<string, unknown>;
    expect(error["type"]).toBe("insufficient_funds");
  });
});
