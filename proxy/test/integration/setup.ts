import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
  erc20Abi,
} from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { serve } from "@hono/node-server";

import type { Config } from "../../src/config.js";
import { createChainClient } from "../../src/settlement/chain.js";
import type { ChainClient } from "../../src/settlement/chain.js";
import { createMockArweaveStore } from "../../src/settlement/arweave.js";
import type { ArweaveStore } from "../../src/settlement/arweave.js";
import { createServer } from "../../src/server.js";
import { startMockProvider } from "../fixtures/mock-provider.js";

export const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

export const USER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export const ED25519_KEY = "a".repeat(64);
export const ADMIN_API_KEY = "test-admin-key";
export const MOCK_PROVIDER_PORT = 18901;
export const PROXY_PORT = 18902;

const CONTRACTS_DIR =
  process.env["CONTRACTS_DIR"] ??
  join(import.meta.dirname, "../../../contracts");

const FOUNDRY_BIN = join(homedir(), ".foundry", "bin");
const PATH_WITH_FOUNDRY = `${FOUNDRY_BIN}:${process.env["PATH"] ?? ""}`;

export interface TestContext {
  anvil: ChildProcess;
  mockProviderServer: Server;
  proxyServer: ReturnType<typeof serve>;
  vaultAddress: Address;
  usdcAddress: Address;
  config: Config;
  chainClient: ChainClient;
  arweaveStore: ArweaveStore;
  settleAll: () => Promise<void>;
}

function waitForAnvil(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Anvil startup timeout")),
      10000,
    );

    const check = () => {
      const client = createPublicClient({
        chain: foundry,
        transport: http("http://127.0.0.1:8545"),
      });
      client
        .getChainId()
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch(() => setTimeout(check, 200));
    };
    check();
  });
}

function deployContracts(): { vault: Address; usdc: Address } {
  const output = execSync(
    `forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key ${ANVIL_KEY} --broadcast 2>&1`,
    { cwd: CONTRACTS_DIR, encoding: "utf-8", shell: true, env: { ...process.env, PATH: PATH_WITH_FOUNDRY } },
  );

  const usdcMatch = output.match(
    /MockUSDC deployed at: (0x[0-9a-fA-F]+)/,
  );
  const vaultMatch = output.match(
    /LLMintVault deployed at: (0x[0-9a-fA-F]+)/,
  );

  if (!usdcMatch?.[1] || !vaultMatch?.[1]) {
    throw new Error(`Failed to parse deploy output:\n${output}`);
  }

  return {
    usdc: usdcMatch[1] as Address,
    vault: vaultMatch[1] as Address,
  };
}

async function depositForUser(
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

export async function setupTestEnv(): Promise<TestContext> {
  const anvil = spawn("anvil", [], {
    stdio: "pipe",
    env: { ...process.env, PATH: PATH_WITH_FOUNDRY },
    shell: true,
  });

  await waitForAnvil();

  const { vault: vaultAddress, usdc: usdcAddress } = deployContracts();

  await depositForUser(USER_KEY, 100_000000n, vaultAddress, usdcAddress);

  const mockProviderServer = await startMockProvider(MOCK_PROVIDER_PORT);

  const config: Config = {
    port: PROXY_PORT,
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    vaultAddress,
    usdcAddress,
    platformPrivateKey: ANVIL_KEY,
    ed25519PrivateKey: ED25519_KEY,
    adminApiKey: ADMIN_API_KEY,
    upstreamUrl: `http://127.0.0.1:${MOCK_PROVIDER_PORT}`,
    upstreamApiKey: "mock-key",
    defaultLockAmount: "50.0",
    inputTokenPrice: "0.000003",
    outputTokenPrice: "0.000015",
    maxTokensDefault: 4096,
  };

  const chainClient = createChainClient(config);
  const arweaveStore = createMockArweaveStore();
  const { app, settleAll } = createServer({ config, chainClient, arweaveStore });

  const proxyServer = serve({ fetch: app.fetch, port: PROXY_PORT });

  return {
    anvil,
    mockProviderServer,
    proxyServer,
    vaultAddress,
    usdcAddress,
    config,
    chainClient,
    arweaveStore,
    settleAll,
  };
}

export function teardownTestEnv(ctx: TestContext): void {
  ctx.proxyServer.close();
  ctx.mockProviderServer.close();
  ctx.anvil.kill("SIGTERM");
}
