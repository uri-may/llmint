import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Chain,
  type Transport,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";
import type { LLMintConfig } from "./config.js";

const CHAINS: Record<number, Chain> = {
  31337: foundry,
  8453: base,
};

export function getPrivateKey(): `0x${string}` {
  const key = process.env["LLMINT_PRIVATE_KEY"];
  if (!key) {
    throw new Error(
      "LLMINT_PRIVATE_KEY env var not set. Export your wallet private key.",
    );
  }
  if (!key.startsWith("0x")) {
    throw new Error("LLMINT_PRIVATE_KEY must start with 0x");
  }
  return key as `0x${string}`;
}

export function getAccount() {
  return privateKeyToAccount(getPrivateKey());
}

export function getChain(config: LLMintConfig): Chain {
  const chain = CHAINS[config.chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${config.chainId}`);
  }
  return chain;
}

export function getWalletClient(
  config: LLMintConfig,
): WalletClient<Transport, Chain, Account> {
  const account = getAccount();
  const chain = getChain(config);
  return createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });
}

export function getPublicClient(
  config: LLMintConfig,
): PublicClient<Transport, Chain> {
  const chain = getChain(config);
  return createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });
}
