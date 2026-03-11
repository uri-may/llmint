# LLMint

On-chain financial layer for verifiable inference. Deposit USDC, lock funds per session, settle with cryptographic receipts.

**Status:** Stage 2 — contract, CLI, and inference proxy on local devnet.

## Prerequisites

- [Node.js 22+](https://nodejs.org/)
- [pnpm](https://pnpm.io/)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, anvil)

## Setup

```bash
pnpm install
```

## Contracts

LLMintVault manages USDC deposits, session locking, and settlement on Base.

```bash
# Build
cd contracts && forge build

# Test (45 tests: unit, fuzz, invariant)
forge test

# Start local chain
anvil

# Deploy to local Anvil (in another terminal)
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

The deploy script prints MockUSDC and LLMintVault addresses. It mints 10,000 USDC to the first 3 Anvil accounts.

## CLI

```bash
# Set wallet key (Anvil account 0)
export LLMINT_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Initialize config (use addresses from deploy output)
pnpm --filter @llmint/cli build
node cli/dist/index.js init --network local \
  --vault <vault-address> \
  --usdc <usdc-address>

# Deposit, check balance, withdraw, generate auth token
node cli/dist/index.js deposit 50
node cli/dist/index.js balance
node cli/dist/index.js withdraw 10
node cli/dist/index.js auth
```

## Proxy

OpenAI-compatible inference proxy with Ed25519 attestation signing and on-chain settlement.

```bash
# Configure (copy and edit)
cp proxy/.env.example proxy/.env

# Run in development
pnpm --filter @llmint/proxy dev

# Type check
pnpm typecheck
```

The proxy authenticates requests via EIP-191 JWT (from `llmint auth`), forwards to an upstream LLM provider, signs each response with Ed25519, and settles session costs on-chain with merkle-proofed batches.

See `proxy/.env.example` for all configuration options.

## Tests

```bash
# Everything
pnpm test

# By component
pnpm test:contracts          # Solidity tests
pnpm test:cli                # CLI unit + integration
pnpm test:proxy:unit         # Proxy unit tests
pnpm test:proxy:integration  # Proxy integration (needs Foundry)
```

## Project Structure

```
contracts/       Foundry project (Solidity, not in pnpm workspace)
  src/           LLMintVault.sol, MockUSDC.sol
  test/          Unit, fuzz, and invariant tests
  script/        Deploy script (Anvil + Base Sepolia)
  abi/           Generated ABI JSON
cli/             TypeScript CLI (viem + commander)
  src/commands/  init, auth, deposit, withdraw, balance
  src/lib/       config, wallet, jwt, contract, format
proxy/           Inference proxy (hono + viem + noble)
  src/           Server, auth, attestation, session, settlement
  test/          Unit and integration tests
docs/            Specs and plans
```

## License

MIT
