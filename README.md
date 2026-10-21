# Ghostrail

A Next.js application built with React and TypeScript.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the application.

Set `DATABASE_URL` in `.env` to a PostgreSQL connection string. The application
uses `pg` and initializes its PostgreSQL tables automatically on the first
database request.

For the devnet demo only, the application can run an automatic refund worker:

```env
AUTO_REFUND_ENABLED=true
AUTO_REFUND_POLL_MS=30000
BUYER_PRIVATE_KEY=<base58-demo-buyer-private-key>
```

The worker starts with the Node.js server, watches accepted locked payments,
and after each escrow timeout checks the registered seller endpoint. A network
failure or HTTP 5xx response triggers a buyer-signed refund; HTTP 402 and other
4xx responses are treated as reachable because an x402 API may require payment.
This is a devnet demo mechanism, not a production delivery oracle. Keep the
buyer key out of production facilitator deployments.

## Seller service registry

Sellers can register an existing service endpoint, seller wallet, and devnet
USDC price at `/services`. Registrations are listed as unverified; this page
stores the URL but does not call or proxy the seller API or verify ownership.
The facilitator stores registrations, payment records, and accepted signatures
in PostgreSQL. The local JSON database is no longer used.

The seller integration calls `POST /api` to check a buyer-signed transaction. Release and refund calls to `PUT /api` must include a transaction signed by the seller or buyer respectively; the facilitator only adds its fee-payer signature.
That check does not submit the transaction or confirm on-chain settlement.
Sellers must confirm settlement before delivering a resource.

## Available Scripts

- `npm run dev` - Starts the development server
- `npm run build` - Builds the application for production
- `npm run start` - Starts the production server
- `npm run lint` - Runs ESLint to check for code issues

## Escrow program (devnet only)

The Anchor project is in `escrow/`. Its Rust dependencies are declared in
`escrow/Cargo.toml` and resolved by Cargo from `escrow/Cargo.lock`.
Install the Solana CLI, its SBF build tools, Rust/Cargo, and Anchor CLI before
building.

Create a program keypair once, then sync its public key into `Anchor.toml` and
`escrow/src/lib.rs`. The program ID is configured for devnet; keep the
generated keypair private and backed up. The `target/` directory is ignored by
Git so the keypair is not committed.

```powershell
Set-Location escrow
New-Item -ItemType Directory -Force target/deploy | Out-Null
solana-keygen new --no-bip39-passphrase --outfile target/deploy/escrow-keypair.json
anchor keys sync
solana config set --url devnet
solana airdrop 2
solana balance
anchor build
anchor deploy --provider.cluster devnet
```

Fund the configured Solana wallet with devnet SOL before deploying. Confirm the
program ID printed by `anchor keys list` is the ID you expect. The program is
unaudited and intended for devnet only; do not deploy it to mainnet.
