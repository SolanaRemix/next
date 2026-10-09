# Mega Gods Prompt NEXT

An early monorepo foundation for the requested multi-chain wallet and onboarding experience.

## Workspace

- `apps/web` — React, TypeScript, and Vite frontend
- `apps/api` — NestJS read-only perpetual risk-check and aggregator quote API
- `packages/types` — shared wallet, onboarding, perpetual risk, and swap quote types
- `packages/ui` — glassmorphism cards, flash buttons, badges, and theme styles
- `packages/config` — shared theme tokens

Perpetual and swap panels are lazy-loaded. The Solana Web3 provider is loaded only when a Solana wallet operation is requested, keeping Solana dependencies out of the initial JavaScript bundle.

## Local development

Requires Node.js 22 or later and npm.

```sh
npm install
npm run dev
```

In a second terminal, start the API:

```sh
npm run dev:api
```

The API listens on port `3001` by default. Set `PORT` to change it and `WEB_ORIGIN` to configure the single allowed browser origin.

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

The frontend currently includes wallet connection for injected EVM wallets and Phantom/Solflare-compatible Solana wallets, native balance reads, wallet-approved native transfers, skippable onboarding with local persistence and optional API synchronization, and EVM quotes compared across 0x, 1inch, and ParaSwap. The swap API returns indicative prices only; it does not construct, sign, or broadcast swap transactions. The NestJS API also exposes a perpetual margin/liquidation risk simulation only. The risk check does not place, sign, or broadcast orders. Its liquidation estimate is a simplified model, not an exchange quote or trading recommendation. The rest of the trading, database, authentication, PWA, and enterprise controls described in the product requirements are not implemented.

Wallets retain control of private keys. The application does not request or store seed phrases or private keys. Review every network, recipient, amount, and fee in the wallet before approving a transaction.
