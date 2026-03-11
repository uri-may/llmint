import {
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Account,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, foundry } from "viem/chains";

const VAULT_ABI = [
  {
    type: "function",
    name: "lockSession",
    inputs: [
      { name: "user", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      { name: "user", type: "address" },
      { name: "totalCost", type: "uint256" },
      { name: "callCount", type: "uint256" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "chainHash", type: "bytes32" },
      { name: "arweaveTxId", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "availableOf",
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
    name: "sessionNonces",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "settlements",
    inputs: [
      { name: "", type: "address" },
      { name: "", type: "uint256" },
    ],
    outputs: [
      { name: "merkleRoot", type: "bytes32" },
      { name: "chainHash", type: "bytes32" },
      { name: "totalCost", type: "uint256" },
      { name: "callCount", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "arweaveTxId", type: "bytes32" },
    ],
    stateMutability: "view",
  },
] as const;

const CHAINS: Record<number, Chain> = {
  31337: foundry,
  8453: base,
};

export interface ChainClient {
  lockSession(user: Address, amount: bigint): Promise<void>;
  settle(
    user: Address,
    totalCost: bigint,
    callCount: number,
    merkleRoot: `0x${string}`,
    chainHash: `0x${string}`,
    arweaveTxId: `0x${string}`,
  ): Promise<void>;
  availableOf(user: Address): Promise<bigint>;
  lockedOf(user: Address): Promise<bigint>;
  sessionNonces(user: Address): Promise<bigint>;
  settlements(
    user: Address,
    nonce: bigint,
  ): Promise<{
    merkleRoot: `0x${string}`;
    chainHash: `0x${string}`;
    totalCost: bigint;
    callCount: bigint;
    timestamp: bigint;
    arweaveTxId: `0x${string}`;
  }>;
}

export function createChainClient(config: {
  rpcUrl: string;
  chainId: number;
  vaultAddress: string;
  platformPrivateKey: string;
}): ChainClient {
  const chain = CHAINS[config.chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${config.chainId}`);
  }

  const account = privateKeyToAccount(
    config.platformPrivateKey as `0x${string}`,
  );

  const publicClient: PublicClient<Transport, Chain> = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  });

  const walletClient: WalletClient<Transport, Chain, Account> =
    createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl),
    });

  const vault = getContract({
    address: config.vaultAddress as Address,
    abi: VAULT_ABI,
    client: { public: publicClient, wallet: walletClient },
  });

  return {
    async lockSession(user: Address, amount: bigint): Promise<void> {
      const hash = await vault.write.lockSession([user, amount]);
      await publicClient.waitForTransactionReceipt({ hash });
    },

    async settle(
      user: Address,
      totalCost: bigint,
      callCount: number,
      merkleRoot: `0x${string}`,
      chainHash: `0x${string}`,
      arweaveTxId: `0x${string}`,
    ): Promise<void> {
      const hash = await vault.write.settle([
        user,
        totalCost,
        BigInt(callCount),
        merkleRoot,
        chainHash,
        arweaveTxId,
      ]);
      await publicClient.waitForTransactionReceipt({ hash });
    },

    async availableOf(user: Address): Promise<bigint> {
      return vault.read.availableOf([user]);
    },

    async lockedOf(user: Address): Promise<bigint> {
      return vault.read.lockedOf([user]);
    },

    async sessionNonces(user: Address): Promise<bigint> {
      return vault.read.sessionNonces([user]);
    },

    async settlements(
      user: Address,
      nonce: bigint,
    ): Promise<{
      merkleRoot: `0x${string}`;
      chainHash: `0x${string}`;
      totalCost: bigint;
      callCount: bigint;
      timestamp: bigint;
      arweaveTxId: `0x${string}`;
    }> {
      const result = await vault.read.settlements([user, nonce]);
      return {
        merkleRoot: result[0],
        chainHash: result[1],
        totalCost: result[2],
        callCount: result[3],
        timestamp: result[4],
        arweaveTxId: result[5],
      };
    },
  };
}
