# Mega Gods Prompt NEXT

An early monorepo foundation for the requested multi-chain wallet and onboarding experience.

## Workspace

- `apps/web` — React, TypeScript, and Vite frontend
- `apps/api` — NestJS API with PostgreSQL-backed JWT authentication, RBAC, rate limiting, risk checks, and aggregator quotes
- `packages/types` — shared wallet, onboarding, auth roles, perpetual risk, and swap quote types
- `packages/ui` — glassmorphism cards, flash buttons, badges, and theme styles
- `packages/config` — shared theme tokens

Perpetual and swap panels are lazy-loaded. The Solana Web3 provider is loaded only when a Solana wallet operation is requested, keeping Solana dependencies out of the initial JavaScript bundle.

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

Solana swap execution has a database-backed, global kill switch that is created disabled by migration. Only an active SuperAdmin can inspect it with `GET /api/admin/financial-controls/execution` or change it with `PATCH /api/admin/financial-controls/execution` and a JSON body such as `{"enabled":false,"reason":"incident response"}`. Every change and reason is stored in the audit log in the same database transaction, with concurrent changes serialized for accurate audit history. Keep execution disabled until production checks are complete; disabling blocks new admissions but cannot cancel submissions already in flight or transactions already forwarded to Jupiter or the chain. If the control row is unavailable, execution fails closed.

Configure `ZEROX_API_KEY` and `ONEINCH_API_KEY` on the API server for those providers; ParaSwap quoting is attempted without an API key. These secrets are never sent to the browser. Each provider is queried independently, so successful routes are returned when another provider is unavailable.

The authenticated Solana token market searches Jupiter Token API v2 and Jupiter Price API v3, with DEX Screener market pairs used to show Solana venue liquidity, observed prices, and venue spread (including indexed Raydium/Orca pools when present). The panel refreshes on a 30-second interval. This is public market-data aggregation only: provider/indexer coverage varies, prices are indicative, and spread is not an execution slippage or MEV estimate.

The Trader-only Solana swap panel uses Jupiter Swap API V2 `/order` and `/execute`. Set `JUPITER_API_KEY` on the API server; never expose it in the browser. The order path delegates dynamic slippage and landing-fee optimization to Jupiter, and the wallet signs the returned versioned transaction locally. Orders are persisted with user-scoped idempotency and a short expiry; the signed transaction is forwarded for execution but is not stored. Audit events record order and execution outcomes. The status endpoint reconciles interrupted submissions against Solana RPC; set `SOLANA_RPC_URL` to a reliable HTTPS RPC endpoint (defaults to the public mainnet endpoint). Jupiter's managed landing provides MEV mitigation, not a guarantee against MEV or failed transactions. The app does not choose a fixed Jito tip; Jupiter controls provider-side priority/landing fees, whose estimate is returned when available. EVM swaps and perpetuals remain quote/simulation-only.

Run verification:

```sh
npm test
npm run typecheck
npm run build
npm audit
```

The Solana wallet uses the mainnet RPC endpoint by default. Set `VITE_SOLANA_RPC_URL` to use another RPC endpoint. Set `VITE_API_URL` to override the API base URL (defaults to `http://localhost:3001/api`); onboarding progress remains available in local storage if preference synchronization is unavailable.

## Current implementation scope

The API now includes PostgreSQL-backed registration/login, hashed rotating refresh tokens in HttpOnly cookies, short-lived JWT access tokens, role guards, and shared atomic Redis-backed request throttling when `REDIS_URL` is configured. Redis failures fail closed rather than silently switching production instances to independent counters. Development without Redis uses the framework's in-memory limiter. Authenticated swap quote and perpetual risk-check attempts are recorded with actor, outcome, and minimal operational metadata; Solana order and execution requests are also audited. Registration cannot assign privileged roles.

Container probes are available at `GET /api/health/live` (process liveness) and `GET /api/health/ready` (PostgreSQL and configured throttle-storage readiness). In development without Redis, readiness checks PostgreSQL and reports ready while the framework's in-memory throttle store is active. Root `npm test` and `npm run typecheck` generate the Prisma client before running.

The frontend includes session login, signup, and sign-out; wallet connection for injected EVM wallets and Phantom/Solflare-compatible Solana wallets; native balance reads and wallet-approved transfers; a noncustodial Jupiter Solana swap flow; skippable onboarding; and EVM quotes compared across 0x, 1inch, and ParaSwap. The EVM swap API returns indicative prices only, and the perpetual endpoint remains a simplified risk simulation that does not place, sign, or broadcast orders. These estimates are not exchange quotes or trading recommendations. EVM swap settlement, perpetual order execution, wallet/token permission screens, session listing/revocation, enterprise role management, phishing/abuse controls, and comprehensive compliance integrations remain incomplete; this is not yet a production-ready enterprise trading platform. The Solana execution path is an integration foundation and requires provider credentials, database migration, configured RPC, a controlled rollout, and operational monitoring before production use.

Wallets retain control of private keys. The application does not request or store seed phrases or private keys. Review every network, recipient, amount, and fee in the wallet before approving a transaction.
