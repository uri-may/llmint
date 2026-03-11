# E2E Test Infrastructure Design

## Goal

Comprehensive test infrastructure for llmint-platform that provides both regression prevention and security assurance across all moving parts: authentication, attestation, session management, settlement, and inference proxying.

## Architecture: Layered Test Pyramid

Three test layers, each with a distinct scope and speed target.

### Layer 1: Unit Tests (`test/unit/`)

Test individual modules in isolation. External dependencies (chain, upstream provider, filesystem) are mocked. Two categories per module: **functional** (does it work?) and **adversarial** (can it be broken?).

**Speed target:** Entire suite under 5 seconds.

#### New test files

| File | Module | Scenarios |
|------|--------|-----------|
| `test/unit/config.test.ts` | `src/config.ts` | Missing env vars throw with clear messages, invalid hex keys rejected, invalid URLs rejected, default values applied correctly, numeric coercion edge cases |
| `test/unit/format.test.ts` | `src/lib/format.ts` | parseUsdc/formatUsdc round-trip, zero handling, max precision (6 decimals), large amounts near bigint limits, invalid input rejection |
| `test/unit/provider.test.ts` | `src/inference/provider.ts` | Non-streaming: successful call, upstream 500, malformed JSON response, missing usage field. Streaming: successful SSE, incomplete chunks, upstream stream dies mid-response, missing token counts. Both: network timeout handling |

#### Adversarial tests added to existing files

| File | New scenarios |
|------|---------------|
| `auth.test.ts` | Malformed JWT (wrong part count, invalid base64), replayed token (same token used twice), JWT with future `iat`, missing `sub` claim, signature from wrong wallet |
| `server.test.ts` | Malformed request body (missing `messages`, wrong types), upstream provider error propagation, concurrent requests from same wallet (race condition -- see note below), settlement with zero attestations, settlement for unknown wallet |
| `attestation.test.ts` | Attestation with zero tokens (free call), attestation with max uint values. Note: chain hash with zero-filled `prevChainHash` (first call) is already tested; no duplicate needed |
| `session.test.ts` | Concurrent `getOrCreate` calls for the same wallet (TOCTOU race), `checkHeadroom` with exactly-at-boundary cost, `update` after `remove` |
| `merkle.test.ts` | Duplicate leaf values, very large tree (100+ leaves), leaves with identical content |

**Note on session concurrency race:** `SessionManager.getOrCreate()` is async (calls `chainClient.lockSession`) but uses a plain `Map` with no locking. Two concurrent requests for the same wallet can both see no session and both call `lockSession`. The concurrent test should **document this as a known limitation** by demonstrating the race exists. Fixing it (per-wallet lock) is out of scope for the test infra spec but should be tracked as a follow-up issue.

### Layer 2: Integration Tests (`test/integration/`)

Test module wiring with real Anvil and mock provider. Verify that chain interactions work correctly. Inject errors to test failure handling.

**Speed target:** Under 60 seconds (including Anvil boot and contract deploy).

**Protocol dependency:** Checks out `uri-may/llmint-protocol` (public repo) to run `forge script script/Deploy.s.sol` for contract deployment. After deployment, all interaction uses viem with inline ABI. Build-time only dependency. The `CONTRACTS_DIR` env var controls the path; CI sets it to the checkout location, local dev defaults to `../protocol/contracts` relative to repo root.

#### New scenarios

| Area | Scenario | What it proves |
|------|----------|----------------|
| Chain reverts | Lock session with zero balance (no deposit) | Proxy returns appropriate error, no orphan session created |
| Chain reverts | Settle same session twice | Second settle reverts, proxy handles gracefully |
| Chain state | After settlement, verify on-chain: merkle root, cost, call count | Settlement integrity -- contract got exactly what proxy claims |
| Chain state | Session nonce increments across multiple lock/settle cycles | Nonce management prevents replay |
| Upstream failure | Mock provider returns HTTP 500 mid-session | Session state consistent, cost not incremented, subsequent calls work |
| Upstream failure | Mock provider hangs (no response) | Request times out, session not corrupted |
| Streaming failure | Mock provider sends partial SSE then closes | Client gets error, session cost reflects only completed tokens |
| Concurrent | Two wallets making calls simultaneously | Sessions isolated, no cross-contamination of chain hashes or costs |

#### Test infrastructure changes

Add `createFaultyMockProvider()` to `test/fixtures/faulty-mock-provider.ts`. Interface:

```typescript
type FaultBehavior =
  | { mode: "status"; code: number }       // return HTTP error (e.g., 500)
  | { mode: "hang"; durationMs?: number }  // never respond (or respond after delay)
  | { mode: "partial-stream"; chunksBeforeClose: number }  // close mid-SSE

function createFaultyMockProvider(
  port: number,
  behavior: FaultBehavior,
): Promise<Server>
```

The existing `startMockProvider()` stays unchanged for happy-path tests.

### Layer 3: E2E Scenario Tests (`test/e2e/`)

Black-box tests against the running proxy server. A test client sends real HTTP requests with real JWT signatures and verifies everything: HTTP responses, attestation headers, signature validity, and on-chain state.

**Speed target:** Under 90 seconds.

#### Test infrastructure

**`test/e2e/scenarios.test.ts`** -- scenario definitions.

**`test/e2e/client.ts`** -- test client that:
- Signs JWTs with a test wallet (using the same EIP-191 pattern as `@llmint/cli`)
- Makes requests to the proxy (both streaming and non-streaming)
- Accumulates attestation data across calls within a session: attestation hashes from `X-Attestation` headers and SSE attestation events, chain hashes, costs
- Exposes accumulated data for verification in scenarios (e.g., `client.attestationHashes` for merkle root recomputation)

**`test/e2e/setup.ts`** -- reuses the boot sequence from `test/integration/setup.ts` (Anvil, contract deploy, mock provider, proxy server). Deposits are performed directly against the contract via viem using the `depositForUser()` helper, not through the proxy. The deploy script mints MockUSDC to the Anvil deployer account, who then transfers to test wallets.

#### Arweave store in tests

- **Unit tests:** in-memory mock (plain `Map`, no filesystem)
- **Integration tests:** filesystem-based `createMockArweaveStore()` from `src/settlement/arweave.ts`
- **E2E tests:** filesystem-based `createMockArweaveStore()` (same as integration)

#### Scenarios

| Scenario | Steps | Verifies |
|----------|-------|----------|
| Happy path: non-streaming | Deposit, 3 non-streaming calls, settle | Each response has valid `X-Attestation` + `X-Attestation-Signature` headers, attestation signature verifies with Ed25519 public key, settlement tx succeeds, on-chain cost equals sum of 3 attestation costs |
| Happy path: streaming | Deposit, 2 streaming calls, settle | SSE stream delivers chunks + attestation event after `[DONE]`, attestation in SSE event has valid signature, settlement matches |
| Happy path: mixed | Deposit, 1 non-streaming, 1 streaming, settle | Chain hash links correctly across response types, settlement merkle root covers both attestations |
| Budget exhaustion | Deposit small amount, make calls until 402 | Proxy returns 402 when headroom insufficient, all prior calls have valid attestations, can still settle completed calls |
| Unauthorized access | No JWT, expired JWT, wrong wallet's JWT | All return 401, no session created, no on-chain state changed |
| Settlement verification | Deposit, 5 calls, settle, query chain | Client accumulates attestation hashes across 5 calls, recomputes merkle root using `buildMerkleRoot()`, verifies it matches on-chain root. Total cost matches, call count matches, chain hash matches last attestation |
| Multi-wallet isolation | Two wallets deposit, interleave calls, settle both | Each wallet's settlement is independent, costs don't leak, chain hashes are per-wallet |
| Graceful shutdown | Deposit, 3 calls, send SIGTERM to proxy, verify settlement | Shutdown handler settles all active sessions before exiting, on-chain state reflects all calls. Note: `src/index.ts` already registers SIGTERM/SIGINT handlers that call `settleAll()` |

## CI Configuration

The current CI has two jobs (`unit`, `integration`). This spec adds a third `e2e` job. All three run in parallel.

| Job | Needs Anvil | Needs Protocol Repo | Command |
|-----|-------------|---------------------|---------|
| Unit tests + types | No | No | `pnpm typecheck && pnpm test:unit` |
| Integration tests | Yes | Yes | `pnpm test:integration` |
| E2E scenario tests | Yes | Yes | `pnpm test:e2e` |

**New work:**
- Add `"test:e2e": "vitest run test/e2e"` script to `package.json`
- Add `e2e` job to `.github/workflows/ci.yml` (same setup as integration: Foundry toolchain + protocol checkout + `CONTRACTS_DIR` env var)

Branch protection: all three jobs required to pass before merge to main (configured in GitHub repo settings).

## Test Configuration

**Vitest timeouts per layer:**
- Unit tests: 5,000ms default (vitest default is sufficient)
- Integration tests: 30,000ms per test (Anvil operations can be slow)
- E2E tests: 30,000ms per test

**Retries:** None. All tests must be deterministic. Flaky tests are bugs.

**Anvil startup:** The existing `waitForAnvil()` in `test/integration/setup.ts` has a 10-second timeout with 200ms polling. E2E reuses this.

Timeout configuration goes in a `vitest.config.ts` file at the repo root with per-project overrides, or inline in each test file via `describe`-level `timeout` options.

## Scope Boundaries

**In scope:**
- All test layers described above
- New unit test files (config, format, provider)
- Adversarial additions to existing unit test files
- Faulty mock provider fixture
- E2E test client with attestation accumulation
- E2E setup reusing integration boot sequence
- CI job for e2e tests
- Vitest timeout configuration

**Out of scope:**
- Mutation testing
- Real upstream provider tests (OpenRouter, Together.ai)
- Testnet or mainnet chain targets (Anvil only)
- Provider routing logic
- Record/replay of real upstream responses
- Fixing the session concurrency race (tracked separately)
