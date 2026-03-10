import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LLMintConfig {
  network: "local" | "base";
  rpcUrl: string;
  vaultAddress: string;
  usdcAddress: string;
  chainId: number;
}

const CONFIG_DIR = join(homedir(), ".llmint");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const PRESETS: Record<string, Omit<LLMintConfig, "network">> = {
  local: {
    rpcUrl: "http://127.0.0.1:8545",
    vaultAddress: "0x0000000000000000000000000000000000000000",
    usdcAddress: "0x0000000000000000000000000000000000000000",
    chainId: 31337,
  },
  base: {
    rpcUrl: "https://mainnet.base.org",
    vaultAddress: "0x0000000000000000000000000000000000000000",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chainId: 8453,
  },
};

export function getPreset(
  network: string,
): Omit<LLMintConfig, "network"> {
  const preset = PRESETS[network];
  if (!preset) {
    throw new Error(
      `Unknown network: ${network}. Valid: ${Object.keys(PRESETS).join(", ")}`,
    );
  }
  return preset;
}

export async function saveConfig(config: LLMintConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export async function loadConfig(): Promise<LLMintConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as LLMintConfig;
  } catch {
    throw new Error(
      `No config found at ${CONFIG_PATH}. Run 'llmint init' first.`,
    );
  }
}

export { CONFIG_DIR, CONFIG_PATH };
