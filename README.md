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

Newly registered users receive only the `Guest` role. To bootstrap the first administrator, create the account through the UI, then run `BOOTSTRAP_ADMIN_EMAIL=admin@example.com npm run bootstrap:admin --workspace @next/api` once. The script refuses to run after a SuperAdmin exists and audits the promotion. Never expose database credentials or this operation to a public endpoint.

After bootstrap, authenticated SuperAdmins can list active accounts with `GET /api/auth/users?limit=50`, assign roles with `PATCH /api/auth/users/:id/role`, and set an account's `Active` or `Restricted` status with `PATCH /api/auth/users/:id/status`. Status changes require a fixed reason code, are audited, revoke refresh sessions on restriction, and block existing JWT access on the next request. Self-restriction and restriction of the last active SuperAdmin are rejected. This is a manual account-control mechanism, not an integrated KYC, AML, sanctions-screening, or geographic-compliance service.

Configure `ZEROX_API_KEY` and `ONEINCH_API_KEY` on the API server for those providers; ParaSwap quoting is attempted without an API key. These secrets are never sent to the browser. Each provider is queried independently, so successful routes are returned when another provider is unavailable.

Run verification:

```sh
npm test
npm run typecheck
npm run build
npm audit
```

The Solana wallet uses the mainnet RPC endpoint by default. Set `VITE_SOLANA_RPC_URL` to use another RPC endpoint. Set `VITE_API_URL` to override the API base URL (defaults to `http://localhost:3001/api`); onboarding progress remains available in local storage if preference synchronization is unavailable.

## Current implementation scope

The API now includes PostgreSQL-backed registration/login, hashed rotating refresh tokens in HttpOnly cookies, short-lived JWT access tokens, role guards, and shared atomic Redis-backed request throttling when `REDIS_URL` is configured. Redis failures fail closed rather than silently switching production instances to independent counters. Development without Redis uses the framework's in-memory limiter. Authenticated swap quote and perpetual risk-check attempts are recorded with actor, outcome, and minimal operational metadata; full trading, swap settlement, and execution audit trails are not implemented. Registration cannot assign privileged roles.

The frontend includes session login, signup, and sign-out; wallet connection for injected EVM wallets and Phantom/Solflare-compatible Solana wallets; native balance reads and wallet-approved transfers; skippable onboarding; and EVM quotes compared across 0x, 1inch, and ParaSwap. The swap API returns indicative prices only; it does not construct, sign, or broadcast swap transactions. The perpetual endpoint is a simplified risk simulation and does not place, sign, or broadcast orders. These estimates are not exchange quotes or trading recommendations. Trading execution, wallet/token permission screens, session listing/revocation, enterprise role management, phishing/abuse controls, and broader audit coverage remain incomplete; this is not yet a production-ready enterprise trading platform.

Wallets retain control of private keys. The application does not request or store seed phrases or private keys. Review every network, recipient, amount, and fee in the wallet before approving a transaction.
