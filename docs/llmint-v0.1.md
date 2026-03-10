# Verified Inference Protocol

## One-liner

An OpenAI-compatible inference API where every response is cryptographically signed, payments settle in USDT, and session receipts are permanently anchored on-chain via Arweave — OpenRouter with receipts you can prove.

---

## Features

### Wallet-Based Identity & Auth
- No API keys. The user's wallet IS their identity.
- User generates a JWT via the CLI by signing a message with their wallet.
- JWT works as a bearer token anywhere that accepts an API key (Claude Code, Aider, Continue, curl).
- Wallet address maps to on-chain deposit balance — your balance IS your rate limit.

### USDT Deposits & Balance
- User deposits USDT to the platform smart contract on Base.
- Balance is tracked on-chain per wallet address.
- User can withdraw unused balance anytime (minus locked session funds).
- No subscriptions, no invoices, no credit cards. Prepaid only.

### Session Locking
- On first API call, platform locks a portion of the user's balance on-chain (one transaction).
- Locked funds cannot be withdrawn, preventing race conditions.
- If the lock amount runs out mid-session, platform rejects further calls with a 402 until user deposits more.
- Locking works identically for personal balances and pool balances.

### OpenAI-Compatible Inference API
- Standard `/v1/chat/completions` endpoint.
- Drop-in compatible with Claude Code, Aider, Continue, OpenAI SDK, or any tool that supports a custom base URL.
- Supports streaming (SSE).
- Routes to open-source models on dedicated GPU workers running vLLM/TGI.

### Multi-Model Support
- Launch models: DeepSeek V3, DeepSeek Coder V3, Llama 3.1 70B, Mistral Large, Qwen 2.5 72B.
- Model selection via the `model` field in the request body (same as OpenAI).
- Each model has a known weights hash, computed once at worker startup.

### Cryptographic Attestation
- Every API response includes an Ed25519-signed attestation in response headers.
- Attestation contains: request hash (SHA-256 of the prompt), response hash (SHA-256 of the output), model ID, model weights hash, inference parameters, token counts, cost, timestamp, session nonce, call sequence number, chain hash, funding source (personal or pool ID).
- Chain hash: each attestation's hash incorporates the previous attestation's hash, forming an ordered, tamper-evident chain within the session.

### Session Management (Server-Side)
- Platform groups calls by wallet address into sessions automatically.
- User doesn't manage sessions — they just make API calls.
- Session timeout: 30 minutes of inactivity (hardcoded v1).
- Platform tracks per-session state in memory: nonce, call count, total cost, chain hash, list of attestation hashes, locked amount, funding source (personal or pool ID).

### Headroom Reservation
- Before running inference, platform reserves worst-case cost: prompt tokens (known) + max_tokens × output price.
- If reserved amount exceeds available balance (locked minus already consumed), request is rejected with 402.
- After inference, actual cost is recorded (always ≤ reserved).
- Prevents insufficient funds scenarios — mathematically guaranteed.
- Works against personal balance or pool balance depending on the request path.

### Session Settlement
- Triggered automatically on 30-minute inactivity timeout.
- Platform builds a merkle tree from all attestation hashes accumulated in memory during the session.
- Platform uploads the list of attestation hashes (leaves) to Arweave — permanent, tamper-proof, decentralized.
- Platform submits one on-chain transaction: settle or settlePool depending on funding source.
- Contract deducts totalCost from the relevant balance (personal or pool), releases lock, stores the settlement record (merkle root + Arweave tx ID).
- Platform clears session from memory. Stores nothing. Done.

### On-Chain Settlement Record
- Each settled session is permanently recorded on-chain with: merkle root, chain hash, total cost, call count, timestamp, Arweave transaction ID.
- Merkle root enables individual attestation verification via merkle proofs.
- Chain hash enables full-session ordering and completeness verification.
- Arweave tx ID points to the leaf data needed to generate merkle proofs.

### Attestation Verification
- Any user can verify any single API call from a settled session.
- Verification path: fetch leaves from Arweave (using tx ID from on-chain settlement) → build merkle tree → compute proof for the target attestation → verify proof against on-chain merkle root.
- Fully independent of the platform. All data is public (on-chain + Arweave).
- Platform stores nothing after settlement. Platform could be offline or dead.

### Pools (Sponsored Funding)
- Anyone can create a pool tied to any identifier (repo, project, team, org — just a string hashed to bytes32).
- Anyone can fund any existing pool by depositing USDT.
- Pool creator sets: per-user spending limit, and optionally an allowlist of wallets.
- Developers use a pool by pointing their base URL to: `https://api.yourplatform.com/v1/pool/{pool-slug}/chat/completions`.
- Platform identifies the pool from the URL path, charges the pool instead of the user's personal balance.
- Developer still needs a wallet and JWT for identity — the pool pays, but the platform still needs to know WHO is making the call for attestation, per-user limits, and allowlist checks.
- Pool access control: open (anyone with a JWT can use it) or allowlist (only approved wallets).
- Per-user limit enforced on-chain — contract rejects settlement if a user exceeds their limit.
- Pool owner can withdraw unspent pool funds.
- Pools are a generic primitive. The platform doesn't care what the identifier represents. A GitHub App, a website, a Telegram bot, or manual CLI usage can all create and manage pools.

### CLI (Single Tool for Everything)

**Auth & Balance:**
- `verified-cli auth` — connect wallet, sign message, generate JWT for use as API key.
- `verified-cli deposit <amount>` — deposit USDT to personal balance in the contract.
- `verified-cli balance` — show personal balance (total, locked, available) read from contract.
- `verified-cli withdraw <amount>` — withdraw unused personal balance from contract.

**Pool Management:**
- `verified-cli create-pool <identifier> --amount <amount> --per-user-limit <limit>` — create a pool tied to any identifier (e.g., "github:myorg/myrepo", "team:backend", anything).
- `verified-cli fund-pool <identifier> --amount <amount>` — add funds to an existing pool. Anyone can fund any pool.
- `verified-cli pool-status <identifier>` — show pool balance, per-user limit, usage per contributor, allowlist.
- `verified-cli pool-add-user <identifier> --wallet <address>` — add a wallet to the pool's allowlist (pool owner only).
- `verified-cli pool-remove-user <identifier> --wallet <address>` — remove a wallet from the allowlist (pool owner only).
- `verified-cli pool-set-access <identifier> --mode <open|allowlist>` — set pool access mode (pool owner only).
- `verified-cli pool-withdraw <identifier> --amount <amount>` — withdraw unspent pool funds (pool owner only).

**Sessions & Verification:**
- `verified-cli sessions` — list settled sessions with cost, call count, funding source, on-chain tx hash, Arweave tx ID.
- `verified-cli verify <attestation.json>` — full verification of a single attestation: check Ed25519 signature, look up settlement on-chain, fetch leaves from Arweave, build merkle tree, compute proof, verify against on-chain root. One command.
- `verified-cli verify-session <dir>` — verify all attestations in a directory against their on-chain settlement.

**Info:**
- `verified-cli models` — list available models and pricing.

### GPU Worker Architecture
- Each worker is a self-contained unit: HTTP handler + inference engine (vLLM/TGI) + session state (in-memory) + attestation signer + chain client.
- Session affinity via consistent hashing at the load balancer: hash(wallet + model) routes to same worker.
- KV cache reuse: same user hitting same worker means the model can reuse cached key-value projections from previous calls — significant latency reduction for coding agents where context is mostly unchanged between calls.

### Platform Revenue
- Revenue = spread between user-facing token pricing and GPU compute cost.
- No visible "fee" — just competitive per-token pricing.
- Platform earnings accumulate in the smart contract, withdrawable by the platform wallet (protected by `require(msg.sender == platform)`).
- Platform wallet should be a multisig (Safe) for security.
- Revenue is the same whether the call is funded by personal balance or a pool — the platform charges the same token price either way.

---

## User Stories

### Story 1: Developer Sets Up for the First Time

**As a developer, I want to start using the platform so I can run Claude Code against cheap open-source models and pay with crypto.**

1. I install the CLI:
   ```
   npm install -g @verified-inference/cli
   ```
2. I set my wallet private key:
   ```
   export WALLET_PRIVATE_KEY=0x123abc...
   ```
3. I initialize:
   ```
   verified-cli init
   
   Wallet: 0xABC...
   Network: Base
   Contract: 0xVaultAddress...
   Config saved to ~/.verified-inference/config.json
   ```
4. I deposit USDT:
   ```
   verified-cli deposit 50
   
   Approving USDT spending... ✓
   Depositing 50.00 USDT... ✓
   Balance: $50.00
   ```
5. I generate my API key:
   ```
   verified-cli auth
   
   Signing auth message...
   API Key: eyJhbGciOi...
   Expires: 2027-03-10
   ```
6. I configure Claude Code:
   ```
   export ANTHROPIC_BASE_URL=https://api.yourplatform.com/v1
   export ANTHROPIC_API_KEY=eyJhbGciOi...
   ```
7. I run Claude Code. It works. Responses come back from DeepSeek V3 in the standard format.

### Story 2: Coding Agent Makes 200 Calls

**As a developer running a coding agent, I want my agent to make many API calls without worrying about per-call blockchain transactions.**

1. I start Claude Code and ask it to refactor my authentication module.
2. Claude Code sends the first request to `POST /v1/chat/completions`.
3. Platform verifies my JWT, resolves my wallet address, checks my balance ($50).
4. Platform calls `lockSession(myWallet, $10)` on-chain — locks $10 of my balance. One transaction.
5. Platform routes inference to Worker A (by hash of my wallet + deepseek-v3).
6. Worker A runs inference, builds attestation, signs it, returns response.
7. Response headers include: `X-Attestation: base64(...)` and `X-Attestation-Signature: base64(...)`.
8. Claude Code ignores the headers (it doesn't know about them). It parses the JSON body and continues working.
9. Calls 2 through 200 follow the same flow — platform checks headroom, runs inference, signs attestation, returns response. No blockchain transactions. All in-memory.
10. After call 200, I close my laptop. Claude Code stops.
11. 30 minutes pass. Platform detects the session is idle.
12. Platform builds a merkle tree from the 200 attestation hashes in memory.
13. Platform uploads the 200 hashes to Arweave. Gets back a transaction ID.
14. Platform calls `settle(myWallet, nonce, $4.20, 200, merkleRoot, chainHash, arweaveTxId)` on-chain. One transaction.
15. Contract deducts $4.20 from my balance, releases the $10 lock. My balance is now $45.80.
16. Platform clears the session from memory. Stores nothing.

Total on-chain transactions for 200 API calls: deposit (1) + lock (1) + settle (1) = 3.

### Story 3: Balance Runs Low Mid-Session

**As a developer, I want to be prevented from overspending so I don't accumulate debt.**

1. My balance is $2.00. Locked amount is $2.00 (full balance locked at session start).
2. I've consumed $1.85 of inference so far.
3. I send another request. Prompt is 1,200 tokens, max_tokens is 4,096.
4. Platform calculates headroom: prompt cost ($0.0004) + worst case completion (4096 × $0.0009/1K = $0.0037) = $0.0041.
5. Platform checks: consumed ($1.85) + headroom ($0.0041) = $1.854 ≤ locked ($2.00). OK, proceed.
6. 50 calls later, consumed is $1.96. Next call headroom is $0.05.
7. $1.96 + $0.05 = $2.01 > $2.00 locked.
8. Platform rejects with HTTP 402:
   ```json
   {
     "error": {
       "type": "insufficient_balance",
       "message": "Insufficient balance for this request",
       "balance": "2.00",
       "consumed": "1.96",
       "available": "0.04",
       "estimated_cost": "0.05",
       "deposit_address": "0x..."
     }
   }
   ```
9. Claude Code receives the 402 and stops.
10. I deposit $20 more USDT:
    ```
    verified-cli deposit 20
    ```
11. Platform's event listener detects the deposit, updates my balance.
12. Current session auto-settles. New session starts on next call with a fresh lock.
13. I restart Claude Code. Next call succeeds.

### Story 4: User Tries to Withdraw During Active Session

**As a malicious user, I want to withdraw my deposit while still making API calls (race condition attack).**

1. I deposit $50. Platform locks $10 for my active session.
2. I try to call `withdraw($50)` on the contract.
3. Contract computes: available = balance ($50) - locked ($10) = $40.
4. Contract allows withdrawal of $40, not $50.
5. My $10 is still locked. Platform can still settle against it.
6. Attack fails. I can't get free inference.

### Story 5: Sponsor Creates a Pool for an Open Source Project

**As an open source maintainer, I want to sponsor AI inference for my contributors so they can use coding agents on my repo without paying.**

1. I create a pool:
   ```
   verified-cli create-pool "github:myorg/myproject" \
     --amount 500 \
     --per-user-limit 25
   
   Pool created ✓
   Pool ID: 0xabc123...
   Identifier: github:myorg/myproject
   Balance: $500.00
   Per-user limit: $25.00
   Access: open
   
   Share with contributors:
     Base URL: https://api.yourplatform.com/v1/pool/github:myorg/myproject
   ```
2. I post in the repo README:
   ```markdown
   ## AI-Assisted Development
   This project sponsors AI inference for contributors.
   
   1. Install: npm install -g @verified-inference/cli
   2. Authenticate: verified-cli auth
   3. Configure:
      export ANTHROPIC_BASE_URL=https://api.yourplatform.com/v1/pool/github:myorg/myproject
      export ANTHROPIC_API_KEY=<your JWT from step 2>
   4. Code: claude "fix the bug in auth.ts"
   ```

### Story 6: Contributor Uses a Sponsored Pool

**As a contributor, I want to use the project's sponsored inference without depositing my own money.**

1. I have no USDT. I don't need any.
2. I install the CLI and authenticate (I still need a wallet for identity):
   ```
   verified-cli auth
   
   API Key: eyJhbGciOi...
   ```
3. I configure Claude Code with the pool URL from the README:
   ```
   export ANTHROPIC_BASE_URL=https://api.yourplatform.com/v1/pool/github:myorg/myproject
   export ANTHROPIC_API_KEY=eyJhbGciOi...
   ```
4. I run Claude Code. It works.
5. Platform receives my request, extracts pool from URL path.
6. Platform checks: pool has funds? Yes ($500). My wallet on allowlist or pool is open? Open. My per-user spent < $25 limit? Yes ($0). Proceed.
7. Platform locks from the pool, runs inference, returns response.
8. I've now spent $0.50 from the pool. I have $24.50 of my $25 limit remaining.
9. I never deposited anything. The sponsor paid.

### Story 7: Sponsor Manages Pool Access

**As a sponsor, I want to restrict who can use my pool to only approved contributors.**

1. I switch the pool to allowlist mode:
   ```
   verified-cli pool-set-access "github:myorg/myproject" --mode allowlist
   ```
2. I add specific contributors:
   ```
   verified-cli pool-add-user "github:myorg/myproject" --wallet 0xAlice
   verified-cli pool-add-user "github:myorg/myproject" --wallet 0xBob
   ```
3. Random wallet 0xEve tries to use the pool URL. Platform checks the allowlist. 0xEve is not on it. Request rejected with 403.
4. I check pool usage:
   ```
   verified-cli pool-status "github:myorg/myproject"
   
   Pool: github:myorg/myproject
   Balance: $347.20 / $500.00
   Access: allowlist (3 users)
   Per-user limit: $25.00
   
   Usage:
     0xAlice:  $18.30 / $25.00
     0xBob:    $12.50 / $25.00
     0xCarol:   $2.00 / $25.00
   ```
5. I add more funds:
   ```
   verified-cli fund-pool "github:myorg/myproject" --amount 200
   
   Pool funded ✓
   Balance: $547.20
   ```

### Story 8: Anyone Sponsors Someone Else's Pool

**As a community member, I want to fund a pool I didn't create.**

1. I see a popular open source project using the platform.
2. I fund their pool:
   ```
   verified-cli fund-pool "github:coolproject/awesome-tool" --amount 100
   
   Pool funded ✓
   Balance: $1,247.00 (total from all sponsors)
   ```
3. I'm not the pool owner. I can't change settings, add users, or withdraw. I just added funds. Anyone can do this.

### Story 9: User Verifies a Single API Response (Has All Attestations)

**As a developer, I want to verify that a specific API response was legitimately processed by the model I requested.**

1. I configured my workflow to save all attestation headers to disk during my coding session.
2. I have 200 attestation JSON files in `~/.attestations/session_7/`.
3. Weeks later, I want to verify the entire session.
4. I run:
   ```
   verified-cli verify-session ./session_7/
   ```
5. The CLI:
   - Reads all 200 attestation files.
   - Computes hashes for all 200 (the leaves).
   - Builds the merkle tree.
   - Reads the settlement record on-chain for my wallet + session nonce 7.
   - Compares the computed merkle root with the on-chain merkle root.
   - Verifies the Ed25519 signature on every attestation.
   - Verifies the chain hash links correctly across all calls.
6. Output:
   ```
   Session 7 | 200 calls | $4.20 | funded by: pool github:myorg/myproject
   ✓ All 200 signatures valid (platform key 0x1a2b...)
   ✓ Signing key registered on-chain
   ✓ Chain hash integrity verified (no insertions or reordering)
   ✓ Merkle root matches on-chain settlement
   ✓ Settlement tx: 0xdef... (March 10, 2026)
   ✓ Total cost matches: $4.20
   
   All 200 attestations verified.
   ```

### Story 10: User Verifies a Single API Response (Has Only One Attestation)

**As a developer, I only saved one attestation file, not the whole session. I still want to verify it.**

1. I have one file: `call_42.json`.
2. I run:
   ```
   verified-cli verify ./call_42.json
   ```
3. The CLI:
   - Reads the session nonce and wallet from the attestation.
   - Looks up the settlement on-chain → finds the Arweave transaction ID.
   - Fetches the leaf list from Arweave: `https://arweave.net/{txId}`.
   - Receives the list of 200 attestation hashes (the leaves).
   - Builds the merkle tree from the Arweave data.
   - Computes the proof for call #42's hash.
   - Verifies the proof against the on-chain merkle root.
   - Verifies the Ed25519 signature.
4. Output:
   ```
   ✓ Signature valid (platform key 0x1a2b...)
   ✓ Signing key registered on-chain
   ✓ Merkle proof valid against on-chain root
   ✓ Settlement tx: 0xdef... (March 10, 2026)
   ✓ Model: deepseek-v3 (weights: sha256:789...)
   ✓ Cost: $0.00108
   
   This response is cryptographically proven to be part
   of settled session 7.
   ```
5. No platform involvement. The CLI fetched everything from on-chain + Arweave. The platform could be offline or dead.

### Story 11: Platform Crashes Mid-Session

**As a user, I want my funds to be safe even if the platform goes down.**

1. I've made 150 API calls. Total cost so far: $3.00. Lock amount: $10.
2. Platform server crashes. Memory is wiped.
3. My 150 attestations: the platform lost them (they were in memory). If I was saving attestation headers, I still have them on my disk. If not, they're lost.
4. My funds: $50 balance, $10 locked in the contract. Safe on-chain.
5. The unsettled $3.00 of inference: platform ate the GPU cost. I was never charged. This is the platform's loss, not mine.
6. Platform restarts with empty state.
7. The $10 lock: platform calls an admin function to release stale locks, or the contract has an auto-unlock timeout (e.g., 24 hours of no settlement).
8. I make a new API call. Platform starts a fresh session. Everything works.

### Story 12: Third-Party Audit

**As a compliance auditor, I want to verify that a company's AI agent made specific API calls and that they were charged correctly.**

1. The company provides me with 5 attestation files from calls they want audited.
2. I don't trust the company. I don't trust the platform. I only trust math and the blockchain.
3. For each attestation, I run:
   ```
   verified-cli verify ./attestation_file.json
   ```
4. The CLI fetches leaves from Arweave, builds the merkle tree, verifies the proof against the on-chain root, checks the signature against the on-chain key registry.
5. Every check passes. I now know:
   - These API calls happened.
   - They were processed by the claimed model.
   - They were part of a session that was financially settled on-chain.
   - The total session cost matches the sum of individual attestations.
6. I did all of this without contacting the platform or the company's servers.

### Story 13: Platform Tries to Cheat (Fake Calls)

**As a platform operator, what if I tried to inflate a user's bill with phantom calls?**

1. User made 200 real calls costing $3.50.
2. I insert 50 fake attestation hashes into the merkle tree, inflating the cost to $5.00.
3. I settle on-chain with total_cost = $5.00 and a merkle root covering 250 leaves.
4. I upload 250 leaves to Arweave (including 50 fakes).
5. User saved their 200 attestations. They rebuild the merkle tree from the Arweave leaves.
6. User hashes their 200 saved attestations. Only 200 of the 250 Arweave leaves match.
7. 50 leaves in the Arweave data have no matching attestation in the user's records.
8. User detects the mismatch. Dispute is provable — the user has 200 signed attestations, the on-chain settlement claims 250.
9. Additionally, the chain hash won't match — the user's last chain hash covers 200 calls, the settlement claims 250.

### Story 14: Developer Checks Their Spending

**As a developer, I want to see how much I've spent and on what.**

1. I run:
   ```
   verified-cli balance
   Balance: $45.80 | Locked: $0.00 | Available: $45.80
   ```
2. I check session history:
   ```
   verified-cli sessions
   
   Session 7 | Mar 10 | 200 calls | $4.20 | deepseek-v3 | personal
     Settlement: 0xabc... | Arweave: ar://xyz...
   Session 6 | Mar 9  | 85 calls  | $1.50 | llama-70b | pool:github:myorg/myproject
     Settlement: 0xdef... | Arweave: ar://uvw...
   ```
3. All data read directly from on-chain events. No platform API needed.

---

## What's NOT in Stage 1

- No multi-tenancy / white-label routers
- No agent hosting (just inference routing)
- No SDK
- No dashboard / web UI
- No x402 (just prepaid deposits)
- No custom domains
- No streaming cost cutoff (rely on headroom reservation only)
- No client-initiated settlement (platform settles everything)
- No TEE/hardware attestation (operator attestation only)
- No platform-side proof storage or proof API (Arweave + on-chain only)

---

## Architecture Summary

```
Developer's Machine:
  Claude Code / Aider / any tool
       │
       │ HTTPS + JWT auth
       │
       │ Personal:  POST /v1/chat/completions
       │ Pool:      POST /v1/pool/{identifier}/chat/completions
       ▼
  Load Balancer (consistent hashing by wallet+model)
       │
       ├──→ Worker A (GPU + vLLM + session state + signer)
       ├──→ Worker B
       └──→ Worker C
              │
              │ on session timeout:
              │   1. Build merkle tree from in-memory hashes
              │   2. Upload leaves to Arweave
              │   3. Settle on-chain (personal or pool)
              │   4. Clear memory. Store nothing.
              ▼
       ┌──────────────┐     ┌──────────┐
       │  Base L2      │     │ Arweave  │
       │  Contract     │     │ (leaves) │
       │              │     │          │
       │ - balances   │     │ - 8KB    │
       │ - locks      │     │   per    │
       │ - pools      │     │   session│
       │ - settlements│     │          │
       │ - key registry│    │          │
       └──────────────┘     └──────────┘

  verified-cli (on developer's machine):
    Auth:    auth, init
    Balance: deposit, withdraw, balance
    Pools:   create-pool, fund-pool, pool-status,
             pool-add-user, pool-remove-user,
             pool-set-access, pool-withdraw
    Verify:  verify, verify-session
    Info:    sessions, models
```

## Platform State

```
During session:  in-memory only (session map on GPU worker)
After settlement: nothing. Zero platform storage.
                  Leaves on Arweave. Settlement on-chain.
```

## On-Chain Footprint Per User Session

```
Transactions: 3 (deposit/pool-fund + lock + settle)
Settlement data: ~200 bytes (merkle root, chain hash, cost, count, arweave ID)
Gas cost on Base: ~$0.03 total
```

## Verification Independence

```
To verify any single API call, a user needs:
  1. Their saved attestation file (has it locally)
  2. On-chain settlement record (public, read-only)
  3. Leaf list from Arweave (public, permanent)
  4. Platform's public key from on-chain registry (public)

Platform involvement required: zero.
Platform storage required: zero.
Trust required: zero. Only math.
```
