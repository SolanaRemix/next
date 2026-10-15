# ADR 0001: Contract-first API client generation

- Status: Accepted
- Date: 2026-10-15

## Context

The API has server-side DTO validation but no machine-readable contract or supported typed client. Maintaining endpoint declarations independently risks undocumented or stale routes.

## Decision

Maintain OpenAPI 3.1 as the API contract at `openapi/openapi.yaml`. Generate the `@next/api-client` package from that contract using `openapi-zod-client`, providing typed Zodios clients and Zod runtime request/response schemas. CI compares the OpenAPI path/method set to NestJS controller decorators and verifies generated output is current.

The existing NestJS DTOs and global validation pipe remain the server-side enforcement boundary. The contract and generated SDK do not replace server authorization, DTO validation, or provider-specific checks.

## Consequences

- Contract edits require regenerating and committing the SDK output with `npm run openapi:generate`.
- Route changes without matching contract edits fail CI.
- The SDK validates client requests and parsed responses against contract-generated schemas; API implementation behavior remains governed by the server.
