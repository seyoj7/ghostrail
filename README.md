# Ghostrail

A Next.js application built with React and TypeScript.

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the application.

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
`escrow/src/main.rs`. The ID currently in the source is a placeholder; keep the
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
