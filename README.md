# GHOSTRAIL

GHOSTRAIL is a self-hosted, devnet-only payment facilitator prototype for
x402-style USDC payments on Solana.

The project coordinates an escrow-backed API payment flow in which:

1. A buyer queries an API endpoint and discovers payment requirements via HTTP 402 or the service registry.
2. The buyer signs and submits a transaction locking devnet USDC in an on-chain Anchor escrow.
3. The seller verifies the transaction with GHOSTRAIL (`POST /api`), auto-resolving prices from the registry.
4. Upon delivering the resource, the seller triggers an on-chain release (manually or automatically).
5. If the service fails or times out, the buyer can independently claim an on-chain refund.
6. GHOSTRAIL sponsors transaction fees by co-signing as fee payer.

GHOSTRAIL does not custody escrowed USDC. The Anchor smart contract controls the escrow
vault PDA and enforces all release and refund authorizations.

> **Status:** This is an unaudited Solana devnet prototype. It is not a
> production payment facilitator, delivery oracle, or complete x402 seller
> integration. Do not use real funds or deploy the program to mainnet.

## Architecture

```text
Buyer / AI agent
      |
      | 1. Discovers price via HTTP 402 or GET /api/services/:id
      | 2. Signs & submits USDC escrow-lock transaction
      v
Seller API
      |
      | 3. Forwards transaction to POST /api (with serviceId or explicit params)
      v
Next.js API routes (GHOSTRAIL Facilitator)
      |
      v
Payment verifier
      |
      | 4. Checks programs, signatures, amount, mint, PDAs,
      |    timeout, fee-payer authority, compute budget, and replay
      v
PostgreSQL (Audit log & Replay protection)
      |
      | 5. Service generates & delivers API response
      v
Seller-signed release OR buyer-signed refund
      |
      | 6. PUT /api adds facilitator fee-payer signature
      v
Solana devnet
      |
      v
Anchor escrow program
      |
      +--> USDC released to seller (automatic or manual)
      |
      +--> USDC refunded to buyer (after timeout if service fails)
```

### Application layer

- [`app/`](./app/) contains the Next.js App Router UI and route handlers.
- `/` explains the system and shows the seller integration example.
- `/dashboard` displays recent accepted and rejected verification records.
- `/services` registers seller endpoints, wallets, and prices (generates Service IDs).
- `/docs` is currently only a page shell.

### Backend layer

- [`backend/api.ts`](./backend/api.ts) implements the `/api` handlers.
- [`backend/verify.ts`](./backend/verify.ts) validates buyer-signed lock
  transactions with fail-closed checks.
- [`backend/settlement.ts`](./backend/settlement.ts) validates and submits
  seller-signed releases or buyer-signed refunds.
- [`backend/services.ts`](./backend/services.ts) manages the service registry and auto-resolves token base units from USDC prices.
- [`backend/escrow.ts`](./backend/escrow.ts) reads escrow accounts and derives
  escrow and vault PDAs.
- [`backend/db.ts`](./backend/db.ts) manages PostgreSQL persistence and atomic replay protection.
- [`backend/fee-sponsor.ts`](./backend/fee-sponsor.ts) contains fee-sponsorship
  helpers.
- [`backend/refund-worker.ts`](./backend/refund-worker.ts) provides an opt-in
  devnet demo refund worker.

### Blockchain layer

[`escrow/src/lib.rs`](./escrow/src/lib.rs) is the Rust/Anchor program. It
supports exactly three states:

```text
Locked -> Released
Locked -> Refunded
```

The escrow PDA owns a vault PDA containing the locked USDC. The facilitator and
fee payer cannot authorize either transition.

## Payment lifecycle

### 1. Discovery & Lock

The buyer calls the service endpoint and discovers the required price via HTTP 402, or queries the facilitator registry at `GET /api/services/:id`.

The buyer creates and signs an Anchor `lock` instruction. Its data contains:

```text
8 bytes   Anchor instruction discriminator
8 bytes   escrow ID
8 bytes   USDC amount in base units
8 bytes   timeout timestamp
```

The escrow PDA is derived from:

```text
["escrow", buyer public key, escrow ID]
```

The vault PDA is derived from:

```text
["vault", escrow PDA]
```

The Anchor program transfers USDC from the buyer token account to the vault and
stores the buyer, seller, mint, amount, timeout, and escrow ID.

### 2. Verify

The seller sends the serialized transaction to:

```text
POST /api
```

with a registered service ID (recommended — the facilitator auto-resolves the
price, seller wallet, and mint from the service registry):

```json
{
  "transaction": "<base64 signed Solana transaction>",
  "serviceId": "<registered service UUID>"
}
```

Or with explicit fields (backwards compatible):

```json
{
  "transaction": "<base64 signed Solana transaction>",
  "seller": "<seller public key>",
  "amount": "<USDC base units>",
  "mint": "<USDC mint>"
}
```

The verifier fails closed. It checks:

- Transaction deserialization and signatures.
- Allowed programs only.
- Exactly one genuine escrow `lock` instruction.
- Expected seller, mint, and amount.
- Buyer signature.
- Escrow and vault PDA derivation.
- Timeout between 60 seconds and 3,600 seconds in the future.
- Fee payer is not used as an escrow authority.
- Compute-unit limits.
- Previously failed transaction status.
- Existing escrow account, vault ownership, vault mint, balance, and `Locked`
  state when the account already exists.
- Database replay protection for accepted signatures.

### 3. Settle

Upon delivering the service output, the escrow is settled via:

```text
PUT /api
```

```json
{
  "escrowAddress": "<escrow PDA>",
  "action": "release",
  "transaction": "<base64 partially signed transaction>"
}
```

Settlement can be:
- **Automatic**: The seller service signs and submits the release immediately after returning the AI response (see `services/nvidia/service.py`).
- **Manual**: Triggered using the settlement CLI script (`settle-demo-payment.py`).

For a timeout refund, the buyer signs a refund transaction after the timeout expires.

| Action | Required authority | Destination |
| --- | --- | --- |
| Release | Seller | USDC transferred to Seller; rent returned to Buyer |
| Refund | Buyer | USDC and rent returned to Buyer |

The Anchor program performs the final authorization and token transfer. It
closes the escrow and vault accounts after settlement, while PostgreSQL retains
the application payment record and final state.

## API reference

### Payment and escrow API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api` | Verify a buyer-signed lock transaction (accepts `serviceId` or manual `seller`/`amount`/`mint`) |
| `PUT` | `/api` | Submit a seller release or buyer refund (facilitator co-signs fee) |
| `GET` | `/api` | Return the 50 newest payment records |
| `GET` | `/api?signature=...` | Find a payment record by signature |
| `GET` | `/api?escrowAddress=...` | Read an escrow account from Solana |

### Service registry API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/services` | List registered services |
| `GET` | `/api/services/:id` | Get service details and auto-resolved payment requirements (`seller`, `amount`, `mint`) |
| `POST` | `/api/services` | Register a service endpoint, seller wallet, and price |

Registered services are explicitly marked **Unverified**. GHOSTRAIL does not
call, proxy, or prove ownership of registered URLs.

## Persistence and replay protection

PostgreSQL is configured with `DATABASE_URL`. The schema is initialized
automatically on first use:

- `seen_signatures`: unique accepted transaction signatures for replay protection.
- `payment_records`: accepted and rejected verification attempts, escrow
  addresses, states, and settlement timestamps.
- `registered_services`: seller service metadata and pricing.

Accepted signature claiming and payment-record insertion occur in one atomic database
transaction, preventing concurrent replay attacks.

## Setup

### Node.js application

Install dependencies and start the development server:

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>.

Configure the runtime environment in `.env`:

```env
DATABASE_URL=postgres://...
SOLANA_RPC_URL=https://api.devnet.solana.com
ESCROW_PROGRAM_ID=<deployed-devnet-program-id>
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
FACILITATOR_PRIVATE_KEY=<base58-private-key>
FEE_PAYER_PRIVATE_KEY=<base58-private-key>
```

Never commit or print private-key values.

### Anchor program

Install the Solana CLI, Rust/Cargo, and Anchor CLI. Then:

```powershell
Set-Location escrow
New-Item -ItemType Directory -Force target/deploy | Out-Null
solana-keygen new --no-bip39-passphrase --outfile target/deploy/escrow-keypair.json
anchor keys sync
solana config set --url devnet
solana airdrop 2
anchor build
anchor deploy --provider.cluster devnet
```

Keep the program ID synchronized across `escrow/src/lib.rs`, `escrow/Anchor.toml`, `escrow/idl/escrow.json`, and `.env`.

---

## Python scripts suite

Install dependencies:

```powershell
python -m pip install -r scripts/requirements.txt
```

### 1. `buyer-client.py` (Recommended Buyer Flow)

An automated client demonstrating the complete x402 buyer journey:
1. Calls the paywalled service (intercepts the HTTP 402 challenge).
2. Auto-extracts price, seller wallet, and token mint.
3. Locks devnet USDC in an Anchor escrow.
4. Resubmits the prompt with payment.
5. Prints the AI result and verifies automatic settlement.

```powershell
# Run with default prompt
python scripts/buyer-client.py

# Or pass a custom prompt
python scripts/buyer-client.py "Explain quantum computing in one sentence"

# Or pass a custom service URL and prompt
python scripts/buyer-client.py http://127.0.0.1:8080/chat "Hello world"
```

### 2. `lock-usdc.py` (Minimal Lock Helper)

A concise, single-purpose script (~65 lines) that locks USDC into escrow:

```powershell
# Lock 0.01 USDC for the default seller
python scripts/lock-usdc.py

# Or lock a specific amount for a custom seller
python scripts/lock-usdc.py <SELLER_PUBLIC_WALLET> 0.05
```

Outputs the confirmed Transaction signature, Escrow PDA, and Base64 transaction string.

### 3. `create-demo-payment.py`

Submits an escrow lock and verifies it with GHOSTRAIL (`POST /api`). Supports auto-resolving prices from `SERVICE_ID`:

```powershell
# Using Service ID (price auto-resolved from registry)
$env:SERVICE_ID="<registered-service-uuid>"
python scripts/create-demo-payment.py

# Or manual seller and amount
python scripts/create-demo-payment.py <SELLER_PUBLIC_WALLET> 0.01
```

### 4. `settle-demo-payment.py` (Manual Settlement)

Manually releases or refunds an escrow:

```powershell
# Release to seller after delivery
python scripts/settle-demo-payment.py release <ESCROW_ADDRESS>

# Refund to buyer after 5-minute timeout
python scripts/settle-demo-payment.py refund <ESCROW_ADDRESS>
```

### 5. `generate-keys.py` & `show-addresses.py`

- `python scripts/generate-keys.py`: Generates fresh facilitator and fee-payer keypairs for `.env`.
- `python scripts/show-addresses.py`: Reads `.env` and safely displays only the public addresses.

---

## Python NVIDIA service (`services/nvidia/service.py`)

A standalone, self-contained reference API server demonstrating a paywalled AI service. It wraps NVIDIA's OpenAI-compatible LLM endpoint (`meta/llama-3.3-70b-instruct`) behind GHOSTRAIL payment verification.

### Features
- **In-Code Configuration**: Configuration constants are defined directly in the file (no `.env` dependency required).
- **HTTP 402 Gating**: Returns HTTP 402 with price and seller wallet if called without payment.
- **Automated Settlement**: Automatically signs and submits an on-chain release transaction as soon as the AI response is delivered, depositing funds directly into the seller's wallet.

### Running the service

Start from the repository root:

```powershell
python services/nvidia/service.py
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

Test calling without payment (returns HTTP 402):

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/chat `
  -ContentType "application/json" `
  -Body '{"prompt":"Hello"}'
```

---

## Security and scope limitations

- Devnet only; the escrow program is unaudited.
- Verification does not submit buyer transactions or guarantee settlement.
- Sellers must confirm settlement on-chain before delivering resources.
- Service registrations do not verify endpoint or wallet ownership.
- Fee sponsorship helpers exist, but the complete sponsored lock flow is not
  wired into the main API.
- The automatic refund worker is a demonstration mechanism, not a delivery
  oracle.
- There is currently no `/attack-lab` implementation in the repository.
- Automated tests are not yet present.

## Development commands

```powershell
npm run dev
npm run build
npm run lint
cargo check --manifest-path escrow/Cargo.toml
```
