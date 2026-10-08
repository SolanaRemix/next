# Mega Gods Prompt NEXT

An early monorepo foundation for the requested multi-chain wallet and onboarding experience.

## Workspace

- `apps/web` — React, TypeScript, and Vite frontend
- `packages/types` — shared wallet and onboarding types
- `packages/ui` — glassmorphism cards, flash buttons, badges, and theme styles
- `packages/config` — shared theme tokens

## Local development

Requires Node.js 22 or later and npm.

```sh
npm install
npm run dev
```

Run verification:

```sh
npm test
npm run typecheck
npm run build
npm audit
```

The Solana wallet uses the mainnet RPC endpoint by default. Set `VITE_SOLANA_RPC_URL` to use another RPC endpoint. Set `VITE_API_URL` to enable remote onboarding preference synchronization; onboarding remains usable with local storage when the API is unavailable.

## Current implementation scope

The frontend currently includes wallet connection for injected EVM wallets and Phantom/Solflare-compatible Solana wallets, native balance reads, wallet-approved native transfers, and skippable onboarding with local persistence and optional API synchronization. It does not yet implement the other trading, backend, database, authentication, PWA, or enterprise controls described in the product requirements.

Wallets retain control of private keys. The application does not request or store seed phrases or private keys. Review every network, recipient, amount, and fee in the wallet before approving a transaction.
