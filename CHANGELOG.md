# Changelog

All notable changes to this project are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses Semantic Versioning.

## [Unreleased]

### Added

- OpenAPI 3.1 contract at `openapi/openapi.yaml`, generated typed API client and Zod validation schemas, and CI route-parity checks.

## [1.0.0-rc.1] - 2026-10-14

### Added

- Account registration, login, JWT access sessions, rotating refresh sessions, password changes, session revocation, role-based access, account restrictions, and SuperAdmin account administration.
- EVM and Solana wallet connections, onboarding, wallet-read portfolio features, manually tracked EVM tokens and allowances, wallet-approved transfers/revocations, and read-only cross-chain portfolio aggregation.
- Indicative EVM quotes from 0x, 1inch, and ParaSwap; wallet-mediated 0x EVM and Jupiter Solana swap execution/status flows; and sanitized LI.FI cross-chain quotes.
- Token screening indicators, Solana market search, portfolio price lookups, and a simulation-only perpetual risk check.
- Audited SuperAdmin controls for financial execution and EVM quote providers; PostgreSQL/Prisma persistence; Redis-backed production throttling and selected cache/circuit functions.
- Health endpoints, request-ID logging, optional OTLP tracing and filtered Sentry error reporting, Dockerfiles, Docker Compose, and CI validation for typecheck, tests, build, and dependency audit.
- Architecture, API, security, and operations documentation.

### Changed

- Root package version advanced from `0.1.0` to `1.0.0-rc.1`.
- Production API configuration requires PostgreSQL, a sufficiently long JWT secret, Redis database 0, private allowlisted RPC endpoints for all supported networks, and a LI.FI API key.
- Documentation now describes implemented behavior, authorization boundaries, deployment constraints, and known omissions rather than claiming stable production readiness.

### Security

- Refresh token values are returned only in HttpOnly cookies; PostgreSQL stores token hashes. Passwords are Argon2id-hashed.
- Production RPC endpoints are checked against an exact-host allowlist and known public RPC hostnames are rejected.
- Financial execution is disabled by default, gates new swap operations, and records SuperAdmin changes in the audit log.
- Provider quote responses and bridge estimates are validated and normalized; raw LI.FI transaction data is not exposed by the bridge quote endpoint.

### Known limitations

- This is a release candidate, not the First Stable Production Release. No independent security audit or production certification is represented.
- Bridge execution and bridge status tracking, generated OpenAPI, Enterprise feature flags, coverage thresholds, dedicated security/dependency-review workflows, and an automated release workflow are not implemented.
- Docker Compose provides a single-node Redis Cluster and is not a highly available production topology. Production TLS, origin/network controls, secrets management, backups, monitoring, and scaling require operator setup.
- Token screening and market/pricing responses are provider-dependent indicators or estimates. There is no integrated KYC/AML/sanctions or automated abuse-screening service.
