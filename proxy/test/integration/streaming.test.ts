import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  setupTestEnv,
  teardownTestEnv,
  USER_KEY,
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
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

const BASE_URL = `http://127.0.0.1:${PROXY_PORT}`;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestEnv();
}, 60000);

afterAll(() => {
  if (ctx) teardownTestEnv(ctx);
});

describe("integration: streaming", () => {
  it("streams SSE responses with attestation event", async () => {
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
      .find((line) => line.startsWith("data: {") && line.includes('"attestation"'));

    expect(attestationLine).toBeTruthy();

    const eventData = JSON.parse(attestationLine!.replace("data: ", "")) as Record<
      string,
      unknown
    >;
    expect(eventData["attestation"]).toBeDefined();
    expect(eventData["signature"]).toBeDefined();

    const attestation = eventData["attestation"] as Record<string, unknown>;
    expect(attestation["model"]).toBe("gpt-4");
    expect(attestation["signature"]).toBeUndefined();
    expect(typeof eventData["signature"]).toBe("string");
  });
});
