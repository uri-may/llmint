import { Hono } from "hono";
import type { Address } from "viem";
import { bytesToHex } from "@noble/hashes/utils";

import type { Config } from "./config.js";
import { authMiddleware } from "./middleware/auth.js";
import type { AuthEnv } from "./middleware/auth.js";
import { SessionManager } from "./session/manager.js";
import type { ChainClient } from "./settlement/chain.js";
import type { ArweaveStore } from "./settlement/arweave.js";
import { buildMerkleRoot } from "./settlement/merkle.js";
import { buildAttestation } from "./attestation/builder.js";
import { loadSigningKey } from "./attestation/signer.js";
import { complete, completeStream } from "./inference/provider.js";
import { parseUsdc, formatUsdcTrimmed } from "./lib/format.js";

export interface ServerDeps {
  config: Config;
  chainClient: ChainClient;
  arweaveStore: ArweaveStore;
}

export function createServer(deps: ServerDeps) {
  const { config, chainClient, arweaveStore } = deps;
  const app = new Hono<AuthEnv>();
  const sessions = new SessionManager();
  const signingKey = loadSigningKey(config.ed25519PrivateKey);
  const defaultLockAmount = parseUsdc(config.defaultLockAmount);
  const inputTokenPrice = parseUsdc(config.inputTokenPrice);
  const outputTokenPrice = parseUsdc(config.outputTokenPrice);

  app.get("/health", (c) => c.json({ status: "ok" }));

  const api = new Hono<AuthEnv>();
  api.use("*", authMiddleware);

  api.post("/chat/completions", async (c) => {
    const wallet = c.get("wallet") as Address;
    const requestBody = (await c.req.json()) as Record<string, unknown>;
    const isStreaming = requestBody["stream"] === true;

    const session = await sessions.getOrCreate(
      wallet,
      chainClient,
      defaultLockAmount,
    );

    const maxTokens =
      (requestBody["max_tokens"] as number | undefined) ??
      config.maxTokensDefault;
    const estimatedInputTokens = Math.ceil(
      JSON.stringify(requestBody).length / 4,
    );
    const worstCaseCost =
      BigInt(estimatedInputTokens) * inputTokenPrice +
      BigInt(maxTokens) * outputTokenPrice;

    if (!sessions.checkHeadroom(wallet, worstCaseCost)) {
      return c.json(
        {
          error: {
            message: "Insufficient balance for this request",
            type: "insufficient_funds",
            code: "payment_required",
          },
        },
        402,
      );
    }

    const providerConfig = {
      upstreamUrl: config.upstreamUrl,
      upstreamApiKey: config.upstreamApiKey,
    };

    if (!isStreaming) {
      const result = await complete(providerConfig, requestBody);

      const attestResult = buildAttestation({
        request: requestBody,
        response: result.body,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: 0n,
        nonce: session.nonce,
        callIndex: session.callCount + 1,
        prevChainHash: session.chainHash,
        privateKey: signingKey,
        inputTokenPrice,
        outputTokenPrice,
      });

      const cost =
        BigInt(result.inputTokens) * inputTokenPrice +
        BigInt(result.outputTokens) * outputTokenPrice;

      sessions.update(
        wallet,
        cost,
        attestResult.attestationHash,
        attestResult.chainHash,
      );

      return c.json(result.body, 200, {
        "X-Attestation": JSON.stringify(attestResult.attestation),
        "X-Attestation-Signature": bytesToHex(attestResult.signature),
      });
    }

    const { stream, done } = completeStream(providerConfig, requestBody);

    const encoder = new TextEncoder();
    let attestationEventSent = false;

    const wrappedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done: readerDone, value } = await reader.read();
            if (readerDone) break;
            controller.enqueue(value);
          }

          const result = await done;

          const attestResult = buildAttestation({
            request: requestBody,
            response: result.body,
            model: result.model,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cost: 0n,
            nonce: session.nonce,
            callIndex: session.callCount + 1,
            prevChainHash: session.chainHash,
            privateKey: signingKey,
            inputTokenPrice,
            outputTokenPrice,
          });

          const cost =
            BigInt(result.inputTokens) * inputTokenPrice +
            BigInt(result.outputTokens) * outputTokenPrice;

          sessions.update(
            wallet,
            cost,
            attestResult.attestationHash,
            attestResult.chainHash,
          );

          const attestationEvent = `event: attestation\ndata: ${JSON.stringify({
            attestation: attestResult.attestation,
            signature: bytesToHex(attestResult.signature),
          })}\n\n`;

          controller.enqueue(encoder.encode(attestationEvent));
          attestationEventSent = true;
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(wrappedStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.route("/v1", api);

  const admin = new Hono();

  admin.use("*", async (c, next) => {
    const apiKey = c.req.header("X-Admin-Api-Key");
    if (apiKey !== config.adminApiKey) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  admin.get("/sessions", (c) => {
    const allSessions = sessions.getAll();
    return c.json(
      allSessions.map((s) => ({
        wallet: s.wallet,
        callCount: s.callCount,
        totalCost: formatUsdcTrimmed(s.totalCost),
        lockAmount: formatUsdcTrimmed(s.lockAmount),
        nonce: s.nonce,
      })),
    );
  });

  admin.post("/settle/:wallet", async (c) => {
    const wallet = c.req.param("wallet") as Address;
    const session = sessions.get(wallet);
    if (!session) {
      return c.json({ error: "No active session for wallet" }, 404);
    }

    if (session.attestationHashes.length === 0) {
      return c.json({ error: "No attestations to settle" }, 400);
    }

    const merkleRoot = buildMerkleRoot(session.attestationHashes);
    const txId = await arweaveStore.upload(session.attestationHashes);
    const merkleRootHex = `0x${bytesToHex(merkleRoot)}` as `0x${string}`;
    const chainHashHex = `0x${bytesToHex(session.chainHash)}` as `0x${string}`;
    const arweaveTxIdHex = `0x${txId.slice(0, 64).padEnd(64, "0")}` as `0x${string}`;

    await chainClient.settle(
      wallet,
      session.totalCost,
      session.callCount,
      merkleRootHex,
      chainHashHex,
      arweaveTxIdHex,
    );

    sessions.remove(wallet);

    return c.json({
      settled: true,
      wallet,
      totalCost: formatUsdcTrimmed(session.totalCost),
      callCount: session.callCount,
      merkleRoot: merkleRootHex,
      arweaveTxId: txId,
    });
  });

  app.route("/admin", admin);

  return { app, sessions, settleAll: () => settleAllSessions(sessions, chainClient, arweaveStore) };
}

async function settleAllSessions(
  sessions: SessionManager,
  chainClient: ChainClient,
  arweaveStore: ArweaveStore,
): Promise<void> {
  const allSessions = sessions.getAll();
  for (const session of allSessions) {
    if (session.attestationHashes.length === 0) {
      sessions.remove(session.wallet);
      continue;
    }

    try {
      const merkleRoot = buildMerkleRoot(session.attestationHashes);
      const txId = await arweaveStore.upload(session.attestationHashes);
      const merkleRootHex = `0x${bytesToHex(merkleRoot)}` as `0x${string}`;
      const chainHashHex = `0x${bytesToHex(session.chainHash)}` as `0x${string}`;
      const arweaveTxIdHex = `0x${txId.slice(0, 64).padEnd(64, "0")}` as `0x${string}`;

      await chainClient.settle(
        session.wallet,
        session.totalCost,
        session.callCount,
        merkleRootHex,
        chainHashHex,
        arweaveTxIdHex,
      );

      sessions.remove(session.wallet);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to settle session for ${session.wallet}: ${msg}`);
    }
  }
}
