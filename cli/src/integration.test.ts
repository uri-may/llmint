import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getContract,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { saveConfig, type LLMintConfig } from "./lib/config.js";
import { createVaultClient } from "./lib/contract.js";
import { signJwt, decodeJwt, isExpired } from "./lib/jwt.js";
import { parseUsdc } from "./lib/format.js";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const CONTRACTS_DIR = join(import.meta.dirname, "../../contracts");

let anvil: ChildProcess;
let vaultAddress: Address;
let usdcAddress: Address;
let config: LLMintConfig;

function waitForAnvil(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Anvil startup timeout")),
      10000,
    );

    const check = () => {
      try {
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
      } catch {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

function deployContracts(): { vault: Address; usdc: Address } {
  const output = execSync(
    `source ~/.zshenv && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --private-key ${ANVIL_KEY} --broadcast 2>&1`,
    { cwd: CONTRACTS_DIR, encoding: "utf-8", shell: "/bin/zsh" },
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

beforeAll(async () => {
  process.env["LLMINT_PRIVATE_KEY"] = ANVIL_KEY;

  anvil = spawn("anvil", [], {
    stdio: "pipe",
    env: { ...process.env, PATH: process.env["PATH"] },
    shell: "/bin/zsh",
  });

  await waitForAnvil();

  const addresses = deployContracts();
  vaultAddress = addresses.vault;
  usdcAddress = addresses.usdc;

  config = {
    network: "local",
    rpcUrl: "http://127.0.0.1:8545",
    vaultAddress,
    usdcAddress,
    chainId: 31337,
  };

  await saveConfig(config);
}, 30000);

afterAll(() => {
  if (anvil) {
    anvil.kill("SIGTERM");
  }
});

describe("integration: deposit + withdraw + balance", () => {
  it("deposits USDC and reads balance", async () => {
    const vault = createVaultClient(config);
    const account = privateKeyToAccount(ANVIL_KEY);

    await vault.approveUsdc(parseUsdc("50"));
    await vault.deposit(parseUsdc("50"));

    const balance = await vault.balanceOf(account.address);
    expect(balance).toBe(parseUsdc("50"));
  });

  it("withdraws USDC", async () => {
    const vault = createVaultClient(config);
    const account = privateKeyToAccount(ANVIL_KEY);

    await vault.withdraw(parseUsdc("10"));

    const balance = await vault.balanceOf(account.address);
    expect(balance).toBe(parseUsdc("40"));
  });

  it("reads all balance fields", async () => {
    const vault = createVaultClient(config);
    const account = privateKeyToAccount(ANVIL_KEY);

    const [total, locked, available] = await Promise.all([
      vault.balanceOf(account.address),
      vault.lockedOf(account.address),
      vault.availableOf(account.address),
    ]);

    expect(total).toBe(parseUsdc("40"));
    expect(locked).toBe(0n);
    expect(available).toBe(parseUsdc("40"));
  });
});

describe("integration: auth (JWT)", () => {
  it("signs and verifies a JWT", async () => {
    const account = privateKeyToAccount(ANVIL_KEY);
    const token = await signJwt(account);

    const { header, payload } = decodeJwt(token);
    expect(header.alg).toBe("EIP191");
    expect(payload.sub).toBe(account.address);
    expect(isExpired(payload)).toBe(false);
  });
});
