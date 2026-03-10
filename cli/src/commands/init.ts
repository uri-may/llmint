import { Command } from "commander";
import { getPreset, saveConfig, type LLMintConfig } from "../lib/config.js";

export const initCommand = new Command("init")
  .description("Initialize LLMint config with network presets")
  .requiredOption(
    "--network <network>",
    "Network preset: local or base",
  )
  .option("--rpc-url <url>", "Override RPC URL")
  .option("--vault <address>", "Override vault contract address")
  .option("--usdc <address>", "Override USDC contract address")
  .option("--chain-id <id>", "Override chain ID")
  .action(async (opts: {
    network: string;
    rpcUrl?: string;
    vault?: string;
    usdc?: string;
    chainId?: string;
  }) => {
    const preset = getPreset(opts.network);

    const config: LLMintConfig = {
      network: opts.network as "local" | "base",
      rpcUrl: opts.rpcUrl ?? preset.rpcUrl,
      vaultAddress: opts.vault ?? preset.vaultAddress,
      usdcAddress: opts.usdc ?? preset.usdcAddress,
      chainId: opts.chainId ? parseInt(opts.chainId, 10) : preset.chainId,
    };

    await saveConfig(config);

    console.log(`Network: ${config.network}`);
    console.log(`RPC: ${config.rpcUrl}`);
    console.log(`Vault: ${config.vaultAddress}`);
    console.log(`USDC: ${config.usdcAddress}`);
    console.log(`Chain ID: ${config.chainId}`);
    console.log(`Config saved to ~/.llmint/config.json`);
  });
