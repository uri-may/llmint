# LLMint Protocol: Open-Source Release Design

Date: 2026-03-11

## Goal

Make the protocol repo (`llmint-protocol`) a credible, transparent open-source project. The primary audience is users and reviewers who want to verify the on-chain financial layer is sound. This is not an ecosystem/SDK play — it's a trust artifact.

## Context

LLMint has two repos:

- **protocol** (public, `uri-may/llmint-protocol`) — vault contract (Solidity), CLI (TypeScript). Handles deposits, withdrawals, session locking, on-chain settlement.
- **platform** (private) — inference proxy, attestation signing, Arweave storage, model routing. Calls into the protocol's vault contract.

Stage 1 (contract + CLI) is complete. The protocol repo currently contains docs that describe both protocol and platform concerns intermixed. The CLI lacks verification commands and isn't published to npm.

## Design

### 1. Docs Split

**Principle:** protocol repo documents what's verifiable on-chain and in the CLI. Platform repo documents what runs inference and produces attestations.

**Protocol spec (`docs/llmint-v0.1.md`) retains:**

- What LLMint protocol is (on-chain financial layer for verifiable AI inference)
- Vault contract API: `deposit`, `withdraw`, `lockSession`, `settle`, `releaseStaleLock`, `withdrawEarnings`, `setPlatformPublicKey`
- Settlement record format: merkle root, chain hash, cost, call count, Arweave TX ID
- Attestation format: field definitions, canonical JSON serialization rules, Ed25519 signature scheme
- Attestation verification: how to independently verify signatures, chain integrity, merkle roots
- JWT auth spec: EIP-191 wallet-signed tokens
- CLI commands: `init`, `auth`, `deposit`, `withdraw`, `balance`, `sessions`, `verify request`, `verify session`
- Platform public key: on-chain storage and discovery
- Privacy model (see section 5)

**Docs split also fixes:** All USDT references in the retained protocol spec updated to USDC (matching the implemented contract). All "API Key" references updated to "Token" for consistency with the CLI rename.

**Stripped to platform repo (`docs/llmint-v0.1.md`):**

Everything removed from the protocol spec, preserved with context:

- Proxy architecture: request routing, OpenAI-compatible endpoint, streaming
- Session management: headroom reservation, timeout logic (30 min inactivity), session state machine
- GPU worker architecture: consistent hashing, KV cache reuse, model routing
- Attestation signing: Ed25519 keypair management, chain hash construction, how the platform builds attestations
- Merkle tree building and Arweave upload
- Pool / sponsored funding mechanics
- End-to-end system flow (deposit -> lock -> inference -> attest -> settle -> verify)
- Admin endpoints: session listing, manual settlement

### 2. README Rewrite

New structure for the protocol repo README:

1. **Header** — project name, one-sentence description: "On-chain financial layer for verifiable AI inference — deposit USDC, lock funds for sessions, settle with cryptographic receipts."
2. **Badges** — CI status, license (MIT)
3. **What This Repo Contains** — explicit scope: vault contract (Solidity), CLI (TypeScript). Note that the inference proxy is a separate system that calls into this protocol.
4. **How It Works** — 4-5 sentence architecture overview. Text diagram: User -> CLI -> Vault Contract <- Platform. Deposit -> lock -> inference (off-chain) -> settle with merkle root -> withdraw. Brief mention that attestations are hashed (content is private) but metadata is public (see Privacy Model in spec).
5. **Contract API** — table of public functions with one-line descriptions. Links to Solidity source.
6. **Verification** — "How to verify settlements yourself." Explains `llmint verify request` for inline checking and `llmint verify session` for full session audits against on-chain + Arweave data.
7. **CLI Usage** — condensed command reference for all commands.
8. **Development** — prerequisites, build, test (contracts + CLI).
9. **Deployment** — addresses table with Base Sepolia and Base Mainnet rows (TBD until deployed).
10. **Security** — link to SECURITY.md, audit status ("audit planned").
11. **Contributing** — link to CONTRIBUTING.md.
12. **License** — MIT.

### 3. CLI Changes

#### New commands

**`llmint sessions --wallet <addr>`**

Lists past settlements for a wallet address. Reads `sessionNonces(wallet)` to get the count, then iterates `settlements(wallet, i)` for i in 0..count-1. Converts the `timestamp` field (uint256, unix seconds) to human-readable date.

Output:
```
Session  Cost      Calls  Settled
1        $12.50    47     2026-03-10 14:23 UTC
2        $3.20     12     2026-03-11 09:15 UTC
```

Output when no settlements exist:
```
No settlements found for 0xABC...
```

Error on invalid wallet address format:
```
Invalid wallet address: "not-an-address"
```

**`llmint verify request --attestation <json> --signature <sig>`**

Verifies a single attestation from HTTP response headers (`X-Attestation`, `X-Attestation-Signature`). The `--signature` flag accepts both hex (`0x...`) and base64 encoding — auto-detected by prefix. The `--attestation` flag accepts raw JSON (matching the `X-Attestation` header value). Fetches the platform's Ed25519 public key from the vault contract on-chain.

Steps:
1. Parse attestation JSON, validate all required fields present (see Attestation Schema below)
2. Read `platformPublicKey` from vault contract
3. Compute `digest = SHA-256(canonicalJson(attestation))` — the 32-byte digest
4. Verify Ed25519 signature: `ed25519.verify(signature, digest, publicKey)` — the platform signs the SHA-256 digest, not the raw JSON. Both signer (platform) and verifier (CLI) must agree on this.
5. Validate timestamp is not in the future

Output on success:
```
Attestation valid
  Model: gpt-4
  Tokens: 500 in / 200 out
  Cost: $0.003500
  Session: 3, Call: 7
  Signed by: <public key hex prefix>
```

Output on failure:
```
Attestation INVALID: signature mismatch
```

**`llmint verify session --wallet <addr> --session <id>`**

Full session audit. Fetches attestations from Arweave, verifies against on-chain settlement.

**Arweave data format:** The platform uploads full attestation objects (not just hashes) with their signatures to Arweave as a JSON array: `[{ attestation: {...}, signature: "0x..." }, ...]`. This is required for independent signature verification — hash-only storage would only allow merkle root verification.

Steps:
1. Read settlement record from vault contract (merkle root, chain hash, total cost, call count, Arweave TX ID)
2. If session ID >= `sessionNonces(wallet)`: error "Session N has no settlement record"
3. Fetch attestation data from Arweave using TX ID. If fetch fails: error "Failed to fetch from Arweave: \<error\>"
4. Validate Arweave data format (JSON array of attestation+signature pairs). If malformed: error "Arweave data format invalid"
5. For each attestation: verify Ed25519 signature (same digest method as `verify request`)
6. Verify chain hash integrity (sequential linking)
7. Rebuild merkle tree from attestation hashes, compare root to on-chain value
8. Sum costs and call count, compare to on-chain values

Output on success:
```
Session 3 verified
  Wallet: 0xABC...
  Calls: 47
  Total cost: $12.50
  Merkle root: match
  Chain hash: match
  All signatures: valid
```

Output on failure (example):
```
Session 3 INVALID
  Chain hash: MISMATCH at call 23
  Expected: 0xABC...
  Got: 0xDEF...
```

#### Attestation Schema

The attestation payload (the object that gets canonicalized and signed):

```typescript
{
  requestHash: string     // hex-encoded SHA-256 of canonical JSON of the request
  responseHash: string    // hex-encoded SHA-256 of canonical JSON of the response
  model: string           // model identifier (e.g., "gpt-4")
  inputTokens: number     // prompt token count
  outputTokens: number    // completion token count
  cost: string            // USDC cost (6 decimal string, e.g., "0.003500")
  nonce: number           // session ID (maps to on-chain sessionNonces)
  callIndex: number       // 1-based call sequence within session
  chainHash: string       // hex-encoded bytes32, links to previous attestation
  timestamp: number       // unix seconds
}
```

The `signature` field is NOT part of the attestation payload — it is transmitted alongside but excluded from the canonical JSON used for hashing/signing.

**Chain hash construction:** For each attestation, `chainHash = SHA-256(prevChainHash || attestationHash)` where `attestationHash = SHA-256(canonicalJson(attestation_with_empty_chainHash))`. The attestation is first hashed with `chainHash: ""`, then the real chainHash is computed and set, then the final attestation (with chainHash) is hashed and signed.

#### Canonical JSON specification

Both platform (signer) and CLI (verifier) must produce identical canonical JSON. Since both are JavaScript/TypeScript, the spec relies on JavaScript `JSON.stringify` semantics:

- Sort object keys lexicographically by Unicode code point (recursive)
- Arrays preserve insertion order
- No whitespace (no spaces, no newlines)
- Numbers use JavaScript's default `JSON.stringify` representation (e.g., `1` not `1.0`, `1e+21` for large numbers)
- Strings use JavaScript's default escaping (`\n`, `\t`, `\"`, `\\`, `\uXXXX` for control chars)
- `null` serializes as `null`

This is equivalent to `JSON.stringify(sortKeys(obj))` in both environments. If a non-JavaScript verifier is ever needed, reference RFC 8785 (JSON Canonicalization Scheme) as the target standard — JavaScript semantics are a compatible subset for the data types used in attestations.

#### Existing command changes

- `auth` output: rename "API Key" label to "Token"

#### New verification library

`cli/src/lib/verify.ts` — pure functions, no IO:

- `canonicalJson(obj)` — deterministic JSON serialization per the Canonical JSON specification above
- `verifyAttestationSignature(attestation, signature, publicKey)` — computes `SHA-256(canonicalJson(attestation))`, then `ed25519.verify(signature, digest, publicKey)`
- `verifyChainIntegrity(attestations)` — sequential chain hash verification (see Chain hash construction above)
- `computeMerkleRoot(hashes)` — binary SHA-256 merkle tree. Leaves are attestation hashes (Uint8Array). Internal nodes: `SHA-256(left || right)` with no domain separation prefix (matching the platform's existing implementation). Odd leaf count: duplicate the last leaf. Single leaf: return as root. Empty: throw error.
- `verifySettlement(attestations, settlement)` — full settlement check (merkle root, chain hash, cost sum, call count)

#### New dependencies

- `@noble/ed25519` — Ed25519 signature verification
- `@noble/hashes` — SHA-256, SHA-512

These are the same libraries the platform uses. Pure JS, no native deps, audited.

#### npm publish

- Update `package.json` with `repository`, `keywords`, `license` fields
- Add `prepublishOnly` script: `tsc`
- Publish as `@llmint/cli` to npm so users can run `npx @llmint/cli` or `npm install -g @llmint/cli`

### 4. Contract Change

Add platform public key storage to `LLMintVault.sol`:

```solidity
bytes32 public platformPublicKey;

event PlatformPublicKeyUpdated(bytes32 oldKey, bytes32 newKey);

function setPlatformPublicKey(bytes32 key) external onlyOwner {
    bytes32 oldKey = platformPublicKey;
    platformPublicKey = key;
    emit PlatformPublicKeyUpdated(oldKey, key);
}
```

- Owner-only setter (consistent with existing access control pattern)
- Emits event on change (consistent with existing pattern — every state change emits an event)
- Public getter (auto-generated by Solidity for public state variables)
- `verify` commands read this from chain to get the signing key without trusting external sources

### 5. Privacy Model

Documented in the protocol spec. States facts, no prescriptions.

**Public data (on-chain + Arweave):**
- Wallet address
- Session metadata: model name, input/output token counts, cost per request, timestamps, call count
- Settlement records: merkle root, chain hash, total cost, Arweave TX ID
- Usage patterns: session frequency, spending, model preferences — all correlatable by wallet address

**Private data:**
- Request content: stored as SHA-256 hash (`requestHash`), not plaintext
- Response content: stored as SHA-256 hash (`responseHash`), not plaintext

**Dictionary attack note:**
Common or predictable prompts (e.g., "Hello", boilerplate) could be matched by computing the SHA-256 of the canonical JSON and comparing against the stored `requestHash`. Unique or complex prompts are not practically reversible.

### 6. New Files

**`LICENSE`** — MIT license text.

**`SECURITY.md`** — vulnerability disclosure policy:
- Contact email for reporting
- Expected response timeline
- Scope: vault contract, CLI, cryptographic verification logic
- Out of scope: platform proxy (separate repo)

**`CONTRIBUTING.md`** — contribution guide:
- Prerequisites (Node 22, pnpm, Foundry)
- How to build and test (contracts + CLI)
- PR process, code style expectations
- Link to open issues

**`docs/production-gaps.md`** — living checklist of protocol-layer mocks and gaps to production:
- Access control: single `Ownable` — needs `AccessControl` with `PLATFORM_ROLE` + `ADMIN_ROLE` + multisig
- Key registry: `platformPublicKey` is single key with no rotation history — needs rotation support with historical lookup
- USDC: `MockERC20` on devnet — real USDC on Base mainnet
- Deployment addresses: devnet only — Base Sepolia and mainnet TBD
- Network presets: CLI has `local` and `base` only — add `base-sepolia` preset for testnet interaction

### 7. Testing Strategy

All new tests run in CI alongside existing tests.

#### Contract tests (Foundry, in `contracts/test/`)

**`LLMintVault.t.sol` additions:**

- `test_setPlatformPublicKey`: owner sets key, verify it's stored and readable
- `test_setPlatformPublicKey_emitsEvent`: setting key emits `PlatformPublicKeyUpdated` with old and new values
- `test_setPlatformPublicKey_notOwner`: non-owner reverts
- `test_setPlatformPublicKey_update`: owner can update the key, event contains correct old value
- `test_platformPublicKey_default`: default value is `bytes32(0)`

#### Verification library tests (Vitest, in `cli/src/lib/verify.test.ts`)

All fixture-based, no platform dependency.

**Canonical JSON:**
- Sorts object keys deterministically
- Handles nested objects and arrays
- Produces no whitespace
- Handles edge cases: empty objects, null values, numeric values

**Ed25519 signature verification:**
- Valid attestation with known keypair verifies correctly
- Tampered attestation field (e.g., modified cost) fails verification
- Wrong public key fails verification
- Malformed signature fails verification
- Malformed attestation JSON fails verification

**Chain hash integrity:**
- Valid chain of 1, 2, 5, 20 attestations verifies correctly
- Reordered attestations fail
- Missing attestation in sequence fails
- Tampered chainHash field in one attestation fails
- First attestation chain hash verified against zero-initialized previous hash

**Merkle root:**
- Single attestation: root equals the attestation hash
- Two attestations: root equals SHA-256(left || right) (no domain separation prefix)
- Odd number of attestations: last leaf duplicated, then paired
- Known fixture with pre-computed root matches
- Swapped leaf order produces different root
- Missing leaf produces different root
- Empty input throws error

**Settlement verification:**
- Valid settlement (correct merkle root, chain hash, cost sum, call count) passes
- Merkle root mismatch detected
- Chain hash mismatch detected
- Cost sum mismatch detected (individual costs don't sum to total)
- Call count mismatch detected

#### CLI command tests (Vitest, in `cli/src/commands/`)

**`verify.test.ts`:**
- `verify request` with valid fixture attestation + signature: prints success
- `verify request` with invalid signature: prints failure
- `verify request` with missing `--attestation` flag: prints usage error
- `verify request` with malformed JSON: prints parse error

**`sessions.test.ts`:**
- `sessions` with wallet that has settlements: prints table
- `sessions` with wallet that has no settlements: prints empty message
- `sessions` with invalid wallet address format: prints error

**`verify.test.ts` additional cases for `verify session`:**
- `verify session` with session ID that has no settlement: prints "no settlement record" error
- `verify session` with Arweave fetch failure: prints fetch error
- `verify session` with malformed Arweave data: prints format error

#### Test fixtures (`cli/src/test-fixtures/`)

Pre-computed test data using the platform's known formats:

- `valid-attestation.json` — single attestation with correct Ed25519 signature, generated from a known keypair
- `valid-session.json` — ordered array of 5 attestations with correct chain hashes, valid signatures, and pre-computed merkle root
- `tampered-attestation.json` — attestation with one modified field but original signature (should fail)
- `broken-chain.json` — session with one attestation out of order (chain hash break)
- `settlement-mismatch.json` — session where attestation costs don't sum to settlement total

Fixtures are generated once (can use a script or be hand-crafted from the platform's test data) and committed to the repo. They don't depend on the platform at runtime.

#### CI integration

Existing `ci.yml` already runs:
1. `cd contracts && forge test`
2. `pnpm --filter @llmint/cli test`

No CI changes needed — the new contract tests run with `forge test` and the new CLI tests run with `vitest`. The fixture files are committed to the repo so CI doesn't need external data.

### 8. What This Design Does NOT Include

- SDK or client library for third-party developers (not needed for credibility goal)
- ZK proofs or privacy-preserving verification
- Improvement proposals process (LIPs)
- Separate docs site
- `--json` output flag for CLI commands
- `XDG_CONFIG_HOME` support
- Key rotation or historical key lookup (tracked in production-gaps.md)
- Real Arweave integration (tracked in production-gaps.md, mock has same interface)
