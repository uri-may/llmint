# Repo Consolidation Design

## Goal

Merge `uri-may/llmint-platform` (private) into `uri-may/llmint-protocol` (public) as a `proxy/` workspace package. Rename the repo from `llmint-protocol` to `llmint` to reflect its expanded scope. Open-source the proxy code. Archive the private repo.

## Rationale

The proxy is a protocol implementation, not competitive advantage. The real moat is the GPU provider layer (future RunPod integration). Open-sourcing the proxy:

- Eliminates cross-repo CI checkout hack for integration tests
- Simplifies development (one lockfile, one install, one review workflow)
- Invites ecosystem adoption (other developers can run attestation proxies)
- Strengthens the protocol's network effect

## Target Structure

```
llmint/                          (uri-may/llmint, public)
  contracts/                     (unchanged, Foundry project)
  cli/                           (unchanged, @llmint/cli)
  proxy/                         (renamed from platform, @llmint/proxy)
    src/
      index.ts
      server.ts
      config.ts
      attestation/
      inference/
      middleware/
      session/
      settlement/
      lib/
    test/
      unit/
      integration/
      e2e/                       (from test infra spec, future work)
      fixtures/
    docs/superpowers/specs/
      2026-03-11-e2e-test-infra-design.md
    package.json
    tsconfig.json
    .env.example
  docs/
    llmint-v0.1.md
    stage-1-plan.md
    superpowers/specs/
      2026-03-11-protocol-open-source-design.md
      2026-03-11-repo-consolidation-design.md
  .github/workflows/
    ci.yml                       (merged: 5 jobs)
    claude.yml                   (from platform, updated permissions + pinned actions)
    claude-code-review.yml       (from platform, updated permissions + pinned actions)
  pnpm-workspace.yaml            packages: [cli, proxy]
  package.json                   (merged scripts)
  .gitignore                     (merged)
  .nvmrc
  README.md                      (updated for monorepo)
```

## Step-by-Step Plan

### Step 1: Commit untracked files in protocol repo

Commit `docs/superpowers/specs/2026-03-11-protocol-open-source-design.md` which is currently untracked.

### Step 2: Copy platform files into protocol repo as `proxy/`

Copy all source and test files from the platform repo into `protocol/proxy/`. This includes:

- `src/` (all subdirectories)
- `test/` (all subdirectories)
- `docs/superpowers/specs/2026-03-11-e2e-test-infra-design.md` (into `proxy/docs/`)
- `docs/superpowers/specs/2026-03-11-repo-consolidation-design.md` (into root `docs/superpowers/specs/` since it pertains to the whole repo)
- `package.json` (rename package from `@llmint/platform` to `@llmint/proxy`)
- `tsconfig.json`
- `.env.example`

Does NOT include (handled separately):
- `.github/workflows/` (merged into root)
- `.gitignore` (merged into root)
- `.nvmrc` (already at root — verify both are `22`)
- `pnpm-lock.yaml` (regenerated)
- `node_modules/` (regenerated)

### Step 3: Update workspace configuration

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - "cli"
  - "proxy"
```

**Root `package.json`** — merge scripts:
```json
{
  "scripts": {
    "build:contracts": "cd contracts && forge build && forge inspect LLMintVault abi --json > abi/LLMintVault.json",
    "test:contracts": "cd contracts && forge test",
    "test:cli": "pnpm --filter @llmint/cli test",
    "test:proxy": "pnpm --filter @llmint/proxy test",
    "test:proxy:unit": "pnpm --filter @llmint/proxy test:unit",
    "test:proxy:integration": "pnpm --filter @llmint/proxy test:integration",
    "typecheck": "pnpm --filter @llmint/proxy typecheck",
    "test": "pnpm test:contracts && pnpm test:cli && pnpm test:proxy"
  }
}
```

### Step 4: Fix integration test CONTRACTS_DIR

In `proxy/test/integration/setup.ts`, update the default path from `../../../protocol/contracts` (assumed sibling protocol checkout) to `../../../contracts` (contracts directory in same repo):

```typescript
const CONTRACTS_DIR =
  process.env["CONTRACTS_DIR"] ??
  join(import.meta.dirname, "../../../contracts");
```

This resolves from `proxy/test/integration/` up three levels to the repo root, then into `contracts/`. No cross-repo checkout needed.

### Step 5: Merge CI workflows

Replace the protocol's `ci.yml` with a merged version containing 5 jobs:

| Job | Working directory | Needs Foundry | Steps |
|-----|-------------------|---------------|-------|
| Contracts | `contracts` | Yes | `forge build`, `forge test -vvv`, verify ABI freshness |
| CLI (unit + types) | `cli` | No | `tsc --noEmit`, `vitest run src/lib/` |
| CLI (integration) | `cli` | Yes | `vitest run src/integration.test.ts` |
| Proxy (unit + types) | `proxy` | No | `tsc --noEmit`, `vitest run test/unit/` |
| Proxy (integration) | `proxy` | Yes | `vitest run test/integration/` |

The proxy integration job needs the `foundry-rs/foundry-toolchain` action for Anvil and Forge. It no longer needs a separate protocol repo checkout — contracts are in the same repo.

**Claude review workflows:** Adopt the platform's `claude.yml` and `claude-code-review.yml`. Apply these changes before copying:

1. **Add write permissions to both workflows.** The protocol's `claude-review.yml` had `pull-requests: write` and `issues: write`. Both platform workflows (`claude.yml` and `claude-code-review.yml`) only have `read`. Update both to `write` so Claude can post review comments and act on issues:
   ```yaml
   permissions:
     contents: read
     pull-requests: write
     issues: write
     id-token: write
     actions: read
   ```

2. **Pin actions to SHA hashes.** The platform workflows use unpinned tags (`actions/checkout@v4`, `anthropics/claude-code-action@v1`). Pin to the same SHAs used in the protocol's CI:
   ```yaml
   - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2
   - uses: anthropics/claude-code-action@26ec041249acb0a944c0a47b6c0c13f05dbc5b44  # v1
   ```

3. **Remove the protocol's `claude-review.yml`.** Its custom review prompt (Solidity security, ABI consistency) is superseded by the `claude-code-review.yml` plugin. Project-specific review guidance should live in a `CLAUDE.md` file at the repo root, which the Claude review action reads automatically.

### Step 6: Merge .gitignore

Combine both .gitignore files. The protocol's already covers most cases. Add from platform:
- `.llmint-proxy/` (local arweave mock storage)

Also rename the storage directory reference in `proxy/src/settlement/arweave.ts` from `.llmint-platform` to `.llmint-proxy` for consistency with the package rename.

### Step 7: Update proxy package.json

- Rename package: `@llmint/platform` to `@llmint/proxy`
- Remove `packageManager` field (lives in root package.json only)
- Keep all scripts, dependencies, and devDependencies as-is

### Step 8: Update README.md

Update the root `README.md` to reflect the monorepo structure:
- Add `proxy/` to the project structure section
- Add proxy setup instructions (env vars, `pnpm dev`)
- Update status line to reflect Stage 2 (proxy + attestation)

### Step 9: Run pnpm install and verify

- `pnpm install` at root to regenerate lockfile
- `pnpm test:proxy:unit` to verify proxy unit tests pass
- `pnpm --filter @llmint/proxy typecheck` to verify types
- `pnpm test:cli` to verify CLI tests still pass
- `pnpm build:contracts` to verify contracts build
- `pnpm test:proxy:integration` to verify the CONTRACTS_DIR fix (requires Foundry installed locally)

### Step 10: Commit and push

Single commit with all consolidation changes:
```
Consolidate proxy into monorepo and open-source

Move inference proxy from uri-may/llmint-platform (private) into
proxy/ workspace. Merge CI workflows, fix CONTRACTS_DIR paths,
rename package to @llmint/proxy. Update README for monorepo.
```

Push and verify CI passes with all 5 jobs green.

### Step 11: Rename GitHub repo

```bash
gh repo rename llmint --repo uri-may/llmint-protocol
```

This updates the repo name from `llmint-protocol` to `llmint`. GitHub auto-redirects the old URL. Update the local git remote:

```bash
git remote set-url origin https://github.com/uri-may/llmint.git
```

### Step 12: Archive private repo

```bash
gh repo archive uri-may/llmint-platform --yes
```

This makes the private repo read-only. The URL still resolves but no new pushes are accepted.

## What Changes for Developers

- Clone one repo instead of two
- `pnpm install` at root installs everything
- Integration tests find contracts locally (no CONTRACTS_DIR env var needed for local dev)
- CI is one workflow file with 5 jobs
- Proxy source is publicly auditable

## What Does NOT Change

- Contract source code and ABI
- CLI source code and behavior
- Proxy source code and behavior (only package name and storage dir change)
- Test logic (only CONTRACTS_DIR default path changes)
- Environment variables for proxy deployment
- Smart contract addresses and deployment

## Risks

**GitHub URL change:** Renaming from `llmint-protocol` to `llmint` will break any hardcoded references to the old repo URL. GitHub redirects handle this for browser access, but `git remote` URLs in local clones need updating. Low risk — the repo is new with few consumers.

**pnpm lockfile churn:** Merging two lockfiles into one creates a large diff in the consolidation commit. This is expected and harmless.
