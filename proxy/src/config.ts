import type { Address } from "viem";
import { z } from "zod";

const hexString = z.string().regex(/^0x[0-9a-fA-F]+$/);

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  VAULT_ADDRESS: hexString,
  USDC_ADDRESS: hexString,
  PLATFORM_PRIVATE_KEY: hexString,
  ED25519_PRIVATE_KEY: z.string().regex(/^[0-9a-fA-F]+$/),
  ADMIN_API_KEY: z.string().min(1),
  UPSTREAM_URL: z
    .string()
    .url()
    .default("https://openrouter.ai/api/v1"),
  UPSTREAM_API_KEY: z.string().min(1),
  DEFAULT_LOCK_AMOUNT: z.string().regex(/^\d+(\.\d+)?$/),
  INPUT_TOKEN_PRICE: z.string().regex(/^\d+(\.\d+)?$/),
  OUTPUT_TOKEN_PRICE: z.string().regex(/^\d+(\.\d+)?$/),
  MAX_TOKENS_DEFAULT: z.coerce.number().int().positive().default(4096),
});

export interface Config {
  port: number;
  rpcUrl: string;
  chainId: number;
  vaultAddress: Address;
  usdcAddress: Address;
  platformPrivateKey: `0x${string}`;
  ed25519PrivateKey: string;
  adminApiKey: string;
  upstreamUrl: string;
  upstreamApiKey: string;
  defaultLockAmount: string;
  inputTokenPrice: string;
  outputTokenPrice: string;
  maxTokensDefault: number;
}

export function loadConfig(): Config {
  const parsed = configSchema.parse(process.env);
  return {
    port: parsed.PORT,
    rpcUrl: parsed.RPC_URL,
    chainId: parsed.CHAIN_ID,
    vaultAddress: parsed.VAULT_ADDRESS as Address,
    usdcAddress: parsed.USDC_ADDRESS as Address,
    platformPrivateKey: parsed.PLATFORM_PRIVATE_KEY as Address,
    ed25519PrivateKey: parsed.ED25519_PRIVATE_KEY,
    adminApiKey: parsed.ADMIN_API_KEY,
    upstreamUrl: parsed.UPSTREAM_URL,
    upstreamApiKey: parsed.UPSTREAM_API_KEY,
    defaultLockAmount: parsed.DEFAULT_LOCK_AMOUNT,
    inputTokenPrice: parsed.INPUT_TOKEN_PRICE,
    outputTokenPrice: parsed.OUTPUT_TOKEN_PRICE,
    maxTokensDefault: parsed.MAX_TOKENS_DEFAULT,
  };
}
