# GHOSTRAIL scripts

These scripts are run from the repository root:

```powershell
Set-Location E:\\Programs\\ghostrail
```

They are for the Solana devnet demo. Do not use real funds or production
private keys with them.

## Prerequisites

Install the Node dependencies first:

```powershell
npm install
```

Create a root `.env` file. The demo payment script reads it automatically.
Never commit this file or print its private-key values.

Required for the demo payment:

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
ESCROW_PROGRAM_ID=<deployed-devnet-program-id>
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
BUYER_PRIVATE_KEY=<base58-buyer-private-key>
```

The buyer wallet needs devnet SOL for rent and transaction fees, plus devnet
USDC for the payment.

## `generate-keys.mjs`

Generates fresh Solana keypairs for the facilitator and fee payer. It prints
their base58 private keys and public addresses.

```powershell
node scripts/generate-keys.mjs
```

Copy the two private-key lines into `.env`:

```env
FACILITATOR_PRIVATE_KEY=<base58-facilitator-private-key>
FEE_PAYER_PRIVATE_KEY=<base58-fee-payer-private-key>
```

Fund the displayed public addresses on devnet. These wallets are separate from
the escrow program deployer, buyer, and seller wallets. Do not run this again
unless you intentionally want new wallets.

## `show-addresses.mjs`

Reads `FACILITATOR_PRIVATE_KEY` and `FEE_PAYER_PRIVATE_KEY` from `.env` and
prints only their corresponding public addresses. It does not print private
keys.

```powershell
node scripts/show-addresses.mjs
```

Use the printed addresses to check balances or request devnet SOL.

## `create-demo-payment.mjs`

Creates and submits a devnet escrow lock transaction using the buyer wallet,
then sends the signed transaction to the running facilitator at `POST /api`.
It creates the buyer's associated token account when necessary.
The buyer also pays the escrow account rent, so Solana may serialize the buyer, payer, and seller positions as one account when they use the same wallet.

```powershell
node scripts/create-demo-payment.mjs <SELLER_PUBLIC_WALLET> <AMOUNT_USDC>
```

Example:

```powershell
node scripts/create-demo-payment.mjs 2D8pmhdpZCmWnS23qpWsKecgXts2RAszFjHLDpFXYniD 0.01
```

The seller argument is a public wallet address, never a private key. The
seller wallet should match the seller registered in the GHOSTRAIL Services
page.

Optional environment variables override the command-line arguments:

```env
SELLER_WALLET=<seller-public-wallet>
PAYMENT_AMOUNT_USDC=0.01
FACILITATOR_URL=http://localhost:3000
```

The script requires `SOLANA_RPC_URL`, `ESCROW_PROGRAM_ID`, `USDC_MINT`, and
`BUYER_PRIVATE_KEY`. Amounts use USDC units with up to six decimal places.
The script submits the lock and verifies the payment; it does not release or
refund the escrow.

## `settle-demo-payment.mjs`

Builds a seller-signed release or buyer-signed refund transaction and sends it
to the facilitator at `PUT /api`. The facilitator adds its fee-payer signature
and submits the settlement on devnet.

Release after the seller has delivered the resource:

```powershell
node scripts/settle-demo-payment.mjs release <ESCROW_ADDRESS>
```

Refund after the escrow timeout:

```powershell
node scripts/settle-demo-payment.mjs refund <ESCROW_ADDRESS>
```

Refunds use `BUYER_PRIVATE_KEY`. Releases use `SELLER_PRIVATE_KEY`; when the
seller and buyer are the same wallet, the script can use `BUYER_PRIVATE_KEY`.
Set `FACILITATOR_PUBLIC_KEY` to the facilitator address, or let the script
derive it from the local `FACILITATOR_PRIVATE_KEY` without printing the secret.
The script never submits a settlement until the required buyer or seller
signature is present.

## Typical local flow

Start the facilitator app in one terminal:

```powershell
npm run dev
```

Register the seller at `http://localhost:3000/services`, then run the demo
payment command from another terminal. View accepted payment records at
`http://localhost:3000/dashboard`.

If the contract changes, rebuild it before running the demo and make sure the
program ID in `.env` matches the deployed program:

```powershell
Set-Location escrow
anchor build
Set-Location ..
```
