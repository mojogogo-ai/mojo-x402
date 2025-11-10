# Mojo X402

## Overview

Mojo X402 is an experimental payment assistant focused on the Solana ecosystem. The `frontend/ai_pay/page.tsx` page delivers a guided chat flow that:

- Requests a payment session from the backend (`resourcePayment`)
- Filters for Solana-based payment options (USDC on Devnet)
- Signs and submits the SPL token transfer with the configured service wallet
- Notifies the backend (`resourcePaymentConfirm`) using an encoded X-PAYMENT payload

This repository prepares the Solana-only payment experience for open sourcing.

## Features

- Solana Devnet integration via `@solana/web3.js` and `@solana/spl-token`
- Automatic creation of associated token accounts if the recipient lacks one
- Balance polling for SOL and USDC tied to the service wallet
- Chat-style UX covering payment steps, confirmations, and error handling

## Prerequisites

- Node.js 18+
- Yarn or npm
- Access to a Solana Devnet RPC endpoint (defaults to `https://solana-devnet.api.onfinality.io/public`)

## Getting Started

```bash
# Install dependencies
yarn install

# Start the development server
yarn dev
```

The AI payment view lives at `frontend/ai_pay/page.tsx`.

## Configuration

Update the following constants before deploying beyond local testing:

- `SOLANA_RPC_URL`
- `SOLANA_USDC_MINT`
- `SOLANA_PRIVATE_KEY` (Base58 encoded secret key for the service wallet)
- `SOLANA_DECIMALS`

> ⚠️ Never commit production secrets. Move these values to environment variables or a secure vault in real deployments.

## Backend Integration

The payment flow depends on two backend endpoints:

1. `resourcePayment` – retrieves the payment order and accepted Solana options.
2. `resourcePaymentConfirm` – confirms payment with the transaction hash and amount encoded in X-PAYMENT.

They are documented under `backend/api/Payment-Getway-x402.openapi.json`.

## Development Notes

- Linter warnings about missing type declarations come from local module resolution and do not affect the Solana logic.
- The implementation targets Solana Devnet for demonstration; update mint addresses, RPC URLs, and private keys for other clusters.
- Consider adding wallet-connect support or user-managed key flows before production use.

## License

TBD. Choose and document an open-source license before publishing.
