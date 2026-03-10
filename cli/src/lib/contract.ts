import {
  type Address,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
  getContract,
  erc20Abi,
} from "viem";
import type { LLMintConfig } from "./config.js";
import { getPublicClient, getWalletClient } from "./wallet.js";

const VAULT_ABI = [
  {
    type: "function",
    name: "deposit",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lockedOf",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "availableOf",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export interface VaultClient {
  deposit(amount: bigint): Promise<void>;
  withdraw(amount: bigint): Promise<void>;
  balanceOf(user: Address): Promise<bigint>;
  lockedOf(user: Address): Promise<bigint>;
  availableOf(user: Address): Promise<bigint>;
  approveUsdc(amount: bigint): Promise<void>;
}

export function createVaultClient(config: LLMintConfig): VaultClient {
  const publicClient: PublicClient<Transport, Chain> =
    getPublicClient(config);
  const walletClient: WalletClient<Transport, Chain, Account> =
    getWalletClient(config);

  const vaultAddress = config.vaultAddress as Address;
  const usdcAddress = config.usdcAddress as Address;

  const vault = getContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: walletClient },
  });

  const usdcRead = getContract({
    address: usdcAddress,
    abi: erc20Abi,
    client: { public: publicClient, wallet: walletClient },
  });

  return {
    async deposit(amount: bigint): Promise<void> {
      const hash = await vault.write.deposit([amount]);
      await publicClient.waitForTransactionReceipt({ hash });
    },

    async withdraw(amount: bigint): Promise<void> {
      const hash = await vault.write.withdraw([amount]);
      await publicClient.waitForTransactionReceipt({ hash });
    },

    async balanceOf(user: Address): Promise<bigint> {
      return vault.read.balanceOf([user]);
    },

    async lockedOf(user: Address): Promise<bigint> {
      return vault.read.lockedOf([user]);
    },

    async availableOf(user: Address): Promise<bigint> {
      return vault.read.availableOf([user]);
    },

    async approveUsdc(amount: bigint): Promise<void> {
      const hash = await usdcRead.write.approve([vaultAddress, amount]);
      await publicClient.waitForTransactionReceipt({ hash });
    },
  };
}
