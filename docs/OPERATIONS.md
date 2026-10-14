# Operations

This runbook covers the configuration and operator procedures implemented by the repository. It does not replace deployment-specific reliability, compliance, or incident-response planning.

## Local setup

1. Use Node.js 22 or later, npm, and PostgreSQL.
2. Copy `.env.example` to `.env` and `apps/api/.env.example` to `apps/api/.env`. Set the frontend API URL as needed and configure API `DATABASE_URL`, `JWT_ACCESS_SECRET` (at least 32 bytes), and `WEB_ORIGIN`.
3. Install and initialize:

   ```sh
   npm ci
   npm run db:generate --workspace @next/api
   npm run db:migrate --workspace @next/api
   npm run dev
   ```

4. In another terminal, run `npm run dev:api`. The API defaults to port `3001`; the Vite app defaults to port `5173`. Redis may be omitted in development, in which case rate limiting uses in-memory storage.

## Docker Compose baseline

Copy `.env.example` to `.env` and set unique `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `WEB_ORIGIN`, all private RPC endpoints, `RPC_PRIVATE_HOSTS`, and `LIFI_API_KEY`. Compose requires the seven EVM RPC URLs even if an operator does not intend to expose every chain.

```sh
docker compose up --build
```

The API container applies Prisma migrations before serving. The web container listens on port `8080`; API readiness checks PostgreSQL and Redis. PostgreSQL data and Redis data use named volumes. Compose's Redis process is a password-protected, single-node cluster with no replica or failover. This configuration is not a high-availability production architecture.

## First SuperAdmin bootstrap

Create and verify the intended user account through registration. Run the bootstrap command from the API workspace environment with access to the production database:

```sh
BOOTSTRAP_ADMIN_EMAIL=admin@example.com npm run bootstrap:admin --workspace @next/api
```

The email must match a pre-registered account. The script runs transactionally, audits the role promotion, and refuses to proceed if any SuperAdmin already exists. Restrict database and command access; do not expose this capability through a public endpoint. After bootstrap, SuperAdmins assign roles and account status through the authenticated admin API. Account restrictions are manual controls, not KYC/AML or sanctions decisions.

## Financial execution kill switch

The database migration creates the global execution row with `enabled=false`. Verify it with:

```http
GET /api/admin/financial-controls/execution
```

Only a SuperAdmin can access this endpoint. Keep execution disabled during setup and incident response. Enable or disable it via `PATCH /api/admin/financial-controls/execution` with `{"enabled":false,"reason":"incident response"}` (change the boolean only after approval); each change and reason is audited transactionally. The control blocks new EVM/Solana swap orders and execution admissions. It cannot cancel a transaction already handed to a wallet, sent to Jupiter, or included on chain. If control state is absent, swap execution is disabled.

SuperAdmins can also inspect and update the enabled EVM quote sources at `/api/admin/aggregator-controls/evm-quotes`. This controls quote fan-out only; EVM execution remains 0x-only, independently gated by the global kill switch.

## PostgreSQL and Redis

- Production startup requires a valid PostgreSQL `DATABASE_URL`, a `JWT_ACCESS_SECRET` of at least 32 bytes, and `REDIS_URL` pointing to database 0.
- Apply migrations with `npm run db:migrate --workspace @next/api`. The API container does this at startup; external deployments should run the migration command as a controlled release step before serving traffic.
- Production Redis uses the cluster client seeded by `REDIS_URL`; its advertised node addresses must be reachable from API instances. Use `rediss://` when TLS is required. Redis is shared for production rate limits and selected caching/circuit controls; Redis failure does not enable per-instance fallback.
- `/api/health/live` checks that the API process responds. `/api/health/ready` checks PostgreSQL and configured throttle-storage health. Development without Redis checks PostgreSQL while using in-memory throttling.
- The bundled Compose Redis has no replicas or failover. Production needs a managed/reliable Redis Cluster, PostgreSQL backup/restore practices, capacity monitoring, and tested recovery procedures.

## Private RPC endpoints

Production requires `SOLANA_RPC_URL` plus `EVM_RPC_URL_1`, `_10`, `_56`, `_137`, `_8453`, `_42161`, and `_43114`. Configure `RPC_PRIVATE_HOSTS` as a comma-separated exact-hostname allowlist covering every configured endpoint. The API rejects endpoint hosts not in this allowlist and rejects known public endpoints from a finite list. This validation cannot establish contractual or network privacy; operators must use private provider endpoints, restrict outbound network access, and validate endpoint access independently.

The web app may separately use `VITE_SOLANA_RPC_URL` for browser-side wallet operations. This browser setting is compiled into the frontend and is not governed by the API's `RPC_PRIVATE_HOSTS` check.

Configure provider credentials server-side only:

- `LIFI_API_KEY` is required for production API startup and bridge quote requests.
- `ZEROX_API_KEY` is required for 0x EVM quotes/execution. `ONEINCH_API_KEY` enables 1inch quotes; ParaSwap is queried without an API key.
- `JUPITER_API_KEY` is required for Solana swap execution.
- `COINGECKO_API_KEY` enables portfolio-price requests.

Credentials, provider access limits, API contracts, and supported networks can change; verify vendor configuration before enabling an integration.

## Geographic controls

Set `GEO_BLOCKED_COUNTRIES` to uppercase ISO country codes and `GEO_TRUSTED_PROXY_CIDRS` to the immediate edge-proxy CIDRs allowed to supply `CF-IPCountry`. When restrictions are configured, untrusted immediate peers and missing/unknown country headers are denied. Do not expose an origin path around the trusted edge; enforce this with network/origin rules. These controls do not provide legal advice or compliance screening.

## Monitoring and incident response

Every response carries `X-Request-Id`; API logs include that ID, method, path without query data, status, and duration. Optional `OTEL_EXPORTER_OTLP_ENDPOINT` enables HTTP traces; optional `SENTRY_DSN` reports filtered unexpected errors. These do not trace all providers or database activity. Protect telemetry destinations and do not include credentials or query data in collector URLs.

For a suspected execution incident, have a SuperAdmin disable the global financial control, preserve and review the corresponding audit records, and independently inspect transactions already presented to wallets or submitted to providers. Verify chain status using reliable independent sources. Re-enabling execution requires operator review; the repository does not automate incident approval or cancellation of in-flight transactions.

## Production deployment constraints

The Compose stack is a single-host baseline. Production deployment must independently provide TLS termination, exact trusted CORS origin, secrets management, firewall/network policy, API/web availability and scaling, HA PostgreSQL/Redis, backups and restore tests, monitoring/alerting, and any needed geo/origin controls. There is no built-in deployment orchestration, geo vendor integration, OpenAPI document, bridge execution/status flow, feature-flag service, or automated release workflow in this release candidate.
