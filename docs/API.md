# API

The NestJS API uses the `/api` global prefix. Unless a route is marked public, it requires a valid access-token bearer credential. Role guards are hierarchical: a minimum role includes higher roles. Request DTOs are validated globally; unknown fields are rejected.

The default throttle is 120 requests per 60 seconds. Route-specific limits below override it where shown. Health routes skip throttling and geographic access. The OpenAPI 3.1 contract is maintained in [`../openapi/openapi.yaml`](../openapi/openapi.yaml); its generated typed SDK and Zod validation schemas are in `packages/api-client`.

Run `npm run openapi:generate` after changing the contract. `npm run openapi:check` verifies that every NestJS controller route has exactly one contract operation, minimum-role and public/bearer security metadata match the controllers, and the checked-in SDK generation is current. Import `@next/api-client` to use its generated `api`, `createApiClient(baseUrl)` factory, and `schemas` object. The client validates requests and responses using schemas generated from the OpenAPI contract.

## Routes

| Method | Path | Access | Limit / behavior |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | 5/min; creates a Guest account; returns access session and sets refresh cookie. |
| `POST` | `/api/auth/login` | Public | 5/min; sets refresh cookie. |
| `POST` | `/api/auth/refresh` | Public | 10/min; rotates refresh cookie. |
| `POST` | `/api/auth/logout` | Public | Revokes the presented refresh session and clears cookie. |
| `GET` | `/api/auth/me` | Authenticated | Current account. |
| `GET` | `/api/auth/sessions` | Authenticated | Current user's refresh-session summaries. |
| `PATCH` | `/api/auth/password` | Authenticated | 5/min; verifies current password, replaces password, and revokes other sessions. |
| `DELETE` | `/api/auth/sessions/revoke-others` | Authenticated | Revokes other sessions while preserving the validated current session. |
| `DELETE` | `/api/auth/sessions/:id` | Authenticated | Revokes a session belonging to the caller. |
| `GET` | `/api/auth/users` | SuperAdmin | Bounded, cursor-paginated users. |
| `PATCH` | `/api/auth/users/:id/role` | SuperAdmin | Assigns an account role. |
| `PATCH` | `/api/auth/users/:id/status` | SuperAdmin | Sets account status with a fixed reason code. |
| `GET` | `/api/health/live` | Public | Process liveness; no dependency check. |
| `GET` | `/api/health/ready` | Public | PostgreSQL and throttle-storage readiness. |
| `GET` | `/api/admin/audit-logs` | SuperAdmin | Bounded cursor query with action/actor filters. |
| `GET`, `PATCH` | `/api/admin/financial-controls/execution` | SuperAdmin | Read/update global financial execution control; updates require a reason and are audited. |
| `GET`, `PATCH` | `/api/admin/aggregator-controls/evm-quotes` | SuperAdmin | Read/update enabled EVM quote sources; updates require a reason and are audited. |
| `POST` | `/api/portfolio/evm-allowances/discover` | Viewer+ | 2/min; bounded recent Approval-event discovery only. |
| `POST` | `/api/portfolio/aggregate` | Viewer+ | 5/min; read-only cross-chain portfolio for up to eight accounts. |
| `POST` | `/api/portfolio/evm-prices` | Viewer+ | CoinGecko-backed indicative EVM prices. |
| `POST` | `/api/portfolio/solana-prices` | Viewer+ | CoinGecko-backed indicative Solana mainnet prices. |
| `GET` | `/api/token-screening/evm` | Viewer+ | 10/min; GoPlus EVM token indicators. |
| `GET` | `/api/token-screening/solana` | Viewer+ | 10/min; GoPlus Solana beta indicators. |
| `GET` | `/api/solana-market/search` | Viewer+ | Jupiter and DEX Screener public Solana market data. |
| `POST` | `/api/swaps/quote` | Viewer+ | Indicative 0x, 1inch, and ParaSwap EVM quotes. |
| `POST` | `/api/bridges/quote` | Viewer+ | 5/min; sanitized LI.FI exact-input cross-chain quote; no bridge execution. |
| `POST` | `/api/perpetuals/risk-check` | Trader+ | Risk simulation only; no order placement or execution. |
| `POST` | `/api/swaps/evm/order` | Trader+ | Creates/replays a user-idempotent 0x AllowanceHolder order. |
| `POST` | `/api/swaps/evm/execute` | Trader+ | Records submitted transaction hash and verifies settlement using configured EVM RPC. |
| `GET` | `/api/swaps/evm/:executionId` | Trader+ | Caller-scoped EVM swap status. |
| `POST` | `/api/swaps/solana/order` | Trader+ | Gets/persists Jupiter order and returns unsigned transaction for local wallet signing. |
| `POST` | `/api/swaps/solana/execute` | Trader+ | Relays caller-signed transaction to Jupiter and records execution state. |
| `GET` | `/api/swaps/solana/:executionId` | Trader+ | Caller-scoped Solana swap status. |

For exact request and response schemas, see the DTOs and shared contracts in `apps/api/src/**` and `packages/types/src/index.ts`. Quote and pricing endpoints can return provider errors or unavailable data. Their estimates and screening indicators are not guarantees.

## Authentication and responses

Registration and login return an access token and user summary while setting an HttpOnly refresh-token cookie scoped to `/api/auth`. Refresh rotates the cookie. In production the cookie is Secure and SameSite Strict. Authenticated requests use the access token; account status and token authentication version are checked against PostgreSQL.

The API uses NestJS HTTP exceptions and the framework's standard error response structure; it does not define a separate application-wide custom error envelope. DTO validation failures use the global validation pipe. Responses include `X-Request-Id`; request-completion logs omit query strings, bodies, and headers.
