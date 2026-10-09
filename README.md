# Mega Gods Prompt NEXT

An early monorepo foundation for the requested multi-chain wallet and onboarding experience.

## Workspace

- `apps/web` — React, TypeScript, and Vite frontend
- `apps/api` — NestJS API with PostgreSQL-backed JWT authentication, RBAC, rate limiting, risk checks, and aggregator quotes
- `packages/types` — shared wallet, onboarding, auth roles, perpetual risk, and swap quote types
- `packages/ui` — glassmorphism cards, flash buttons, badges, and theme styles
- `packages/config` — shared theme tokens

Perpetual and swap panels are lazy-loaded. The Solana Web3 provider is loaded only when a Solana wallet operation is requested, keeping Solana dependencies out of the initial JavaScript bundle.

## Phase 0: hardening and operations

Phase 0 adds a GitHub Actions pipeline that runs typecheck, tests, builds, and `npm audit` for pull requests and pushes to `main`. The API production build uses `apps/api/tsconfig.build.json`, which excludes test files. The health endpoints are exempt from geographic access checks, bootstrap-admin uses serializable isolation, and financial-control changes now use serializable transactions with their audit records.

Production API startup requires PostgreSQL, a 32-byte JWT access secret, Redis database 0, a private Solana RPC, and private RPC endpoints for every supported EVM chain. Set `RPC_PRIVATE_HOSTS` to the comma-separated exact hostnames of those private RPC endpoints. Every configured RPC hostname must be in that allowlist; recognized public RPC hosts are rejected even if listed. Public endpoint detection is necessarily finite, so only use provider endpoints contractually configured for private access. Development can continue to use public RPC endpoints.

The Docker Compose stack builds the web and API images and starts PostgreSQL and a password-protected, single-node Redis Cluster with persistent volumes and healthchecks. The API applies Prisma migrations before serving traffic; readiness waits for both PostgreSQL and Redis. Copy `.env.example` to `.env`, set unique URL-safe passwords and private RPC values, and start the stack with:

```sh
docker compose up --build
```

The web app is available at `http://localhost:8080`. Compose requires all seven supported EVM RPC URLs even if a deployment does not expose every chain. The compose file is a single-host deployment baseline; its Redis Cluster has no replica or failover and is not a substitute for managed PostgreSQL/TimescaleDB and a highly available Redis Cluster, backups, TLS termination, secret management, network policy, or multi-replica orchestration.

## Phase 1: core wallet and portfolio (in progress)

Authenticated users can review their 50 most recent refresh sessions in the account panel and revoke active sessions they no longer recognize. The current session is identified without exposing token hashes; revocation is scoped to the authenticated user and audited. Revoking a refresh session prevents future refreshes, but access tokens already issued to that device may remain valid for up to 15 minutes.

The connected wallet portfolio reads native and non-zero SPL/Token-2022 balances from Solana RPC and native balances plus manually tracked ERC-20 balances from the active EVM wallet network. ERC-20 token addresses are stored only in account/network-scoped browser local storage; the interface verifies token metadata and balances through read-only `eth_call`, checks for account/network changes, and never submits token transactions. EVM token discovery is manual. Authenticated Viewer-or-higher EVM sessions can request indicative native and tracked-token USD prices through the API's CoinGecko integration; configure `COINGECKO_API_KEY` in `apps/api/.env` to enable it. The total is omitted if a balance or price is unavailable, and the UI shows the provider timestamp. This is a reference estimate, not an executable quote or guaranteed valuation; EVM token balances are still manual, Solana USD valuation is not included, and simultaneous cross-chain aggregation remains incomplete. ERC-20 allowance management is also explicit and manual: tracked token/spender pairs are stored in account/network-scoped browser local storage, allowance reads use `eth_call`, and revocation is simulated, gas-estimated, and submitted only through the connected wallet. The UI verifies transaction confirmation and a zero allowance afterward; forgetting a tracked pair only removes its local entry and does not change on-chain permissions. This is not automatic approval discovery or a replacement for reviewing contracts and transaction details. Native transfers now require a read-only preflight before review: EVM transfers use `eth_call`, gas estimation, gas price, and balance checks; Solana transfers use `simulateTransaction`, fee estimation, and balance checks. The preflight is repeated immediately before requesting wallet submission, but network state and estimated fees can still change; always verify the wallet's final transaction details.

## Local development

Requires Node.js 22 or later and npm.

```sh
npm install
npm run db:generate --workspace @next/api
npm run db:migrate --workspace @next/api
npm run dev
```

In a second terminal, start the API:

```sh
npm run dev:api
```

Copy `.env.example` to the repository root for the frontend, and `apps/api/.env.example` to `apps/api/.env`. Set the API `DATABASE_URL` and create a random `JWT_ACCESS_SECRET` with at least 32 bytes (for example, `openssl rand -base64 48`). Configure `REDIS_URL` for API throttling; local development can omit it and uses in-memory throttling, while production refuses to start without Redis and uses the Redis Cluster client seeded by this URL. Use a `rediss://` URL for TLS; ensure cluster-advertised node addresses are reachable from API pods. Do not commit either `.env`. Migrations require a running PostgreSQL database. The API listens on port `3001` by default. Set `PORT` to change it and `WEB_ORIGIN` to configure the single allowed browser origin.

Optional geographic restrictions use `GEO_BLOCKED_COUNTRIES=US,GB` and `GEO_TRUSTED_PROXY_CIDRS` with the exact edge-proxy CIDRs allowed to supply Cloudflare's `CF-IPCountry` header. With restrictions enabled, requests from other peers or with missing/unknown country data are denied. The API must not be reachable around that trusted edge; configure firewall/origin rules accordingly. Country-level blocks are an access-control signal, not legal advice or a substitute for jurisdiction-specific compliance.

Newly registered users receive only the `Guest` role. To bootstrap the first administrator, create the account through the UI, then run `BOOTSTRAP_ADMIN_EMAIL=admin@example.com npm run bootstrap:admin --workspace @next/api` once. The script refuses to run after a SuperAdmin exists and audits the promotion. Never expose database credentials or this operation to a public endpoint.

After bootstrap, authenticated SuperAdmins can list accounts with `GET /api/auth/users?limit=50`, assign roles with `PATCH /api/auth/users/:id/role`, and set an account's `Active` or `Restricted` status with `PATCH /api/auth/users/:id/status`. Status changes require one of the fixed reason codes (`account_compromise`, `policy_review`, `legal_request`, `other`), are audited, revoke refresh sessions on restriction, and block existing JWT access on the next request. Self-restriction and restriction or demotion of the last active SuperAdmin are rejected. This is a manual account-control mechanism, not an integrated KYC, AML, sanctions-screening, or geographic-compliance service.

Financial swap execution has a database-backed, global kill switch that is created disabled by migration. Only an active SuperAdmin can inspect it with `GET /api/admin/financial-controls/execution` or change it with `PATCH /api/admin/financial-controls/execution` and a JSON body such as `{"enabled":false,"reason":"incident response"}`. Every change and reason is stored in the audit log in the same database transaction, with concurrent changes serialized for accurate audit history. Keep execution disabled until production checks are complete; disabling blocks new order admissions but cannot cancel transactions already presented to a wallet, already in flight, or forwarded to an aggregator or chain. If the control row is unavailable, execution fails closed.

Configure `ZEROX_API_KEY` and `ONEINCH_API_KEY` on the API server for those providers; ParaSwap quoting is attempted without an API key. These secrets are never sent to the browser. Each provider is queried independently, so successful routes are returned when another provider is unavailable. Configure a trusted HTTPS `EVM_RPC_URL_<chainId>` endpoint for each chain on which settlement receipt verification is enabled (for example `EVM_RPC_URL_1`); do not use public RPCs for production settlement.

The authenticated Solana token market searches Jupiter Token API v2 and Jupiter Price API v3, with DEX Screener market pairs used to show Solana venue liquidity, observed prices, and venue spread (including indexed Raydium/Orca pools when present). The panel refreshes on a 30-second interval. This is public market-data aggregation only: provider/indexer coverage varies, prices are indicative, and spread is not an execution slippage or MEV estimate.

The Trader-only EVM swap execution path creates persisted, user-idempotent 0x AllowanceHolder orders. The browser checks the connected account and chain, requests only the exact sell-token allowance when needed, estimates gas, and asks the wallet to approve and submit the quote transaction. The API never holds keys or broadcasts on the user's behalf. Set `ZEROX_API_KEY` and a reliable per-chain `EVM_RPC_URL_<chainId>`; the settlement endpoint verifies the submitted transaction matches the persisted order, checks its receipt against the canonical block, and requires a chain-specific confirmation depth before recording a terminal result. Defaults are in `apps/api/.env.example`; operators can override `EVM_CONFIRMATIONS_<chainId>` (2–1000) after risk review. A later observed reorg reopens the order and adds an audit event, but confirmation depth is probabilistic and not a guarantee of irreversible finality. The global execution switch gates new orders, not transactions already given to a wallet. Wallet and chain RPCs can disagree or fail; inspect wallet confirmations and an independent block explorer before treating a pending result as final.

The Trader-only Solana swap panel uses Jupiter Swap API V2 `/order` and `/execute`. Set `JUPITER_API_KEY` on the API server; never expose it in the browser. The order path delegates dynamic slippage and landing-fee optimization to Jupiter, and the wallet signs the returned versioned transaction locally. Orders are persisted with user-scoped idempotency and a short expiry; the signed transaction is forwarded for execution but is not stored. Audit events record order and execution outcomes. The status endpoint reconciles interrupted submissions against Solana RPC; set `SOLANA_RPC_URL` to a reliable HTTPS RPC endpoint (defaults to the public mainnet endpoint). Jupiter's managed landing provides MEV mitigation, not a guarantee against MEV or failed transactions. The app does not choose a fixed Jito tip; Jupiter controls provider-side priority/landing fees, whose estimate is returned when available.

Run verification:

```sh
npm test
npm run typecheck
npm run build
npm audit
```

The Solana wallet uses the mainnet RPC endpoint by default. Set `VITE_SOLANA_RPC_URL` to use another RPC endpoint. Set `VITE_API_URL` to override the API base URL (defaults to `http://localhost:3001/api`); onboarding progress remains available in local storage if preference synchronization is unavailable.

## Current implementation scope

The API includes PostgreSQL-backed registration/login, hashed rotating refresh tokens in HttpOnly cookies, short-lived JWT access tokens, role guards, and shared atomic Redis-backed request throttling when `REDIS_URL` is configured. Redis failures fail closed rather than silently switching production instances to independent counters. Development without Redis uses the framework's in-memory limiter. Authenticated swap quote and perpetual risk-check attempts are recorded with actor, outcome, and minimal operational metadata; Solana order and execution requests are also audited. Registration cannot assign privileged roles.

Container probes are available at `GET /api/health/live` (process liveness) and `GET /api/health/ready` (PostgreSQL and configured throttle-storage readiness). In development without Redis, readiness checks PostgreSQL and reports ready while the framework's in-memory throttle store is active. Root `npm test` and `npm run typecheck` generate the Prisma client before running.

The frontend includes session login, signup, sign-out, and refresh-session listing/revocation; wallet connection for injected EVM wallets and Phantom/Solflare-compatible Solana wallets; native and token balance reads for the connected network; manually tracked ERC-20 allowance reads and wallet-approved revocations; simulated wallet-approved native transfers; noncustodial Jupiter Solana and 0x EVM swap flows; skippable onboarding; and indicative EVM quotes compared across 0x, 1inch, and ParaSwap. The perpetual endpoint remains a simplified risk simulation that does not place, sign, or broadcast orders. Neither swap integrations nor risk estimates are trading recommendations. Perpetual order execution, exchange/clearinghouse selection, simultaneous multi-chain/USD portfolio aggregation, automatic token-approval discovery, phishing/abuse controls, and vendor-backed KYC/AML/sanctions screening remain incomplete; this is not yet a production-ready enterprise trading platform. Both swap execution paths require provider credentials, applying database migrations, configured chain RPCs, a controlled rollout, and operational monitoring before production use.

Wallets retain control of private keys. The application does not request or store seed phrases or private keys. Review every network, recipient, amount, and fee in the wallet before approving a transaction.
