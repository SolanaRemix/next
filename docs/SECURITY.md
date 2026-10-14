# Security

This document describes controls implemented in the repository. It is not an independent security audit, certification, or guarantee of production safety.

## Trust boundaries and threat summary

The browser is untrusted, external providers and RPC endpoints may fail or return malformed data, and database/Redis access is privileged. API DTO validation whitelists declared fields and rejects unknown fields. Authentication and role checks are enforced server-side; frontend visibility is not an authorization boundary. External data is parsed and validated before use. Provider outages, invalid configuration, missing production dependencies, and disabled execution controls fail closed for the associated operation.

This application does not integrate KYC, AML, sanctions, phishing, abuse, or legal-compliance services. Geographic restrictions, if configured, are access controls based on country data from a trusted immediate proxy; they are not legal advice or compliance verification.

## Private keys and transaction handling

- Wallet private keys and recovery phrases are not requested, stored, or sent to the API.
- EVM wallet actions request wallet approval in the browser. The EVM swap order API returns the 0x order details needed by the client wallet; it does not sign or broadcast that transaction. Settlement is checked against the configured RPC.
- For Solana swaps, the API obtains an order from Jupiter and returns an unsigned transaction to the client. The connected wallet signs locally. The API accepts the signed transaction and forwards it to Jupiter's execute endpoint; this relay does not give the API custody of the signing key.
- LI.FI may return transaction data upstream, but `/api/bridges/quote` only returns normalized estimate and route metadata. It does not expose that transaction data or offer bridge execution.
- API portfolio, market, price, allowance-discovery, and screening endpoints are read-only. Native transfers and allowance revocations are requested through a connected wallet and require user approval.

Always verify the network, recipient, token, amount, and fees shown by the wallet before approving. Simulations and preflight checks cannot guarantee the final result because chain state and provider estimates can change.

## Credentials and authentication

`DATABASE_URL`, a `JWT_ACCESS_SECRET` of at least 32 bytes, and (in production) `REDIS_URL` are required. Provider credentials are server-side configuration and must never be placed in `VITE_*` settings. Passwords are hashed with Argon2id. Access tokens are short-lived JWTs; opaque refresh tokens rotate, are delivered in an HttpOnly cookie, and are persisted only as SHA-256 hashes. The cookie is `Secure` in production and uses `SameSite=Strict`.

New registrations receive only the `Guest` role. Bootstrap-admin is an operator-run one-time script, not a web endpoint, and refuses promotion if a SuperAdmin already exists. Account restrictions, role changes, financial execution-control changes, provider-control changes, and defined user/security actions write audit records. Audit metadata is intentionally limited and does not contain raw request bodies or secrets.

## RPC allowlist and fail-closed controls

Production API startup requires `RPC_PRIVATE_HOSTS` to list exact hostnames for `SOLANA_RPC_URL` and all seven supported EVM RPC endpoints. The configured RPC URLs must use HTTPS and their hostnames must be allowlisted. A finite list of known public RPC hostnames is explicitly rejected. Host allowlisting does not independently establish that a service is private; use private provider endpoints and enforce egress/network policy.

Production requires shared Redis throttling on database 0. Redis failures do not silently degrade to instance-local production counters. Redis also supports short quote/screening caches and shared provider circuit state. When Redis-backed circuit control is present, the quote circuits use a five-failures-in-30-seconds threshold and a 15-second open interval with a single leased recovery probe. The screening circuits are isolated by provider/network; successful screening responses may be cached for 10 seconds. A screening-cache failure falls back to the provider.

The global financial-execution control is PostgreSQL-backed and starts disabled in its migration. It gates new EVM and Solana swap admissions and fails closed if missing or disabled. Disabling it does not cancel transactions already presented to wallets, submitted to providers, or sent to chains. EVM settlement confirmation depth reduces risk but cannot establish irreversible finality; reorgs can reopen a recorded result and create an audit event.

## Logging, traces, and error reporting

The API accepts only a syntactically valid UUID request ID or generates one, returns it as `X-Request-Id`, and writes one JSON request-completion log containing method, path without query, status, duration, and request ID (with trace/span IDs when available). Request/response bodies, headers, query strings, and credentials are not included in that completion log.

OTLP export is disabled without `OTEL_EXPORTER_OTLP_ENDPOINT`; enabled spans cover inbound HTTP and selected quote-provider attempts, not database or every downstream request. Sentry is optional. Its exception filter reports unexpected server errors with a validated request ID; the Sentry integration removes request data, users, headers, query strings, breadcrumbs, contexts, extras, and stack traces before sending.

## Screening and data limitations

Token screening summarizes provider-reported indicators, not verified safety. Missing signals remain unknown; a complete response can still be stale or inaccurate. The GoPlus Solana endpoint is labeled beta. CoinGecko and market-price values are indicative and may be unavailable. Portfolio totals are withheld when the required asset price or balance is missing. Do not use these tools as transaction authorization or financial advice.

## Audit and validation status

The current CI workflow runs typecheck, tests, build, and `npm audit`. It does not currently define coverage thresholds, CodeQL/security scanning, dependency review, or an independent audit. The API does not currently expose generated OpenAPI documentation. These absences are release-candidate limitations, not controls that should be assumed to exist.
