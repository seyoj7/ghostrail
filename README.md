# GHOSTRAIL

GHOSTRAIL is a self-hosted, devnet-only payment facilitator prototype for
x402-style USDC payments on Solana.

The demo follows the x402 v1 HTTP header flow with a custom `escrow` scheme:

1. A request without `X-PAYMENT` receives HTTP 402 and an `accepts` array with the seller, asset, amount, program ID, and maximum timeout.
2. The buyer signs a lock transaction and retries with a base64 x402 v1 `X-PAYMENT` header.
3. GHOSTRAIL verifies, submits, and confirms the lock before the service handler runs.
4. After the handler succeeds, the seller signs a release; GHOSTRAIL confirms it before returning the resource and `X-PAYMENT-RESPONSE` receipt.
5. If the handler fails, the seller does not release the escrow. The buyer can refund after the timeout.

In the current demo, the buyer pays transaction fees and account rent in devnet SOL. Fee sponsorship for lock transactions is not wired into this x402 flow.

GHOSTRAIL does not custody escrowed USDC. The Anchor smart contract controls the escrow
vault PDA and enforces all release and refund authorizations.

> **Status:** This is an unaudited Solana devnet prototype. It is not a
> production payment facilitator or delivery oracle. The escrow scheme is
> custom and is not compatible with the built-in exact-transfer SVM scheme.
> Do not use real funds or deploy the program to mainnet.

## Architecture

```text
Buyer / AI agent
      |
      | 1. Discovers price via HTTP 402 or GET /api/services/:id
      | 2. Signs lock transaction; retries with X-PAYMENT
      v
Seller API
      |
      | 3. Forwards X-PAYMENT and expected service terms to POST /api
      v
Next.js API routes (GHOSTRAIL Facilitator)
      |
      v
Payment verifier
      |
      | 4. Verifies, submits, and confirms lock before acceptance
      v
PostgreSQL (Audit log & Replay protection)
      |
      | 5. Service handler runs only after confirmed lock
      v
Seller-signed release OR buyer-signed refund
      |
      | 6. Seller signs release; PUT /api adds facilitator fee-payer signature
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
- `/docs` describes the x402 escrow request flow.

### Backend layer

- [`backend/api.ts`](./backend/api.ts) implements the `/api` handlers.
- [`backend/verify.ts`](./backend/verify.ts) validates buyer-signed lock
  transactions; the x402 header path also submits and confirms them before
  returning an accepted result.
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

The buyer calls the paid endpoint without `X-PAYMENT`. It returns HTTP 402 with
a standard x402 v1 `accepts` entry. The escrow-specific program address is
carried in the standard `extra` field:

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "escrow",
    "network": "solana-devnet",
    "maxAmountRequired": "10000",
    "resource": "http://127.0.0.1:8080/chat",
    "description": "USDC payment held in GHOSTRAIL escrow",
    "mimeType": "application/json",
    "payTo": "<seller public key>",
    "maxTimeoutSeconds": 300,
    "asset": "<USDC mint>",
    "extra": { "escrowProgramId": "<escrow program ID>" }
  }]
}
```

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

The buyer signs the lock but does not submit it. The transaction is sent in the
x402 `X-PAYMENT` header as a base64-encoded v1 payment payload whose
`payload.transaction` field contains the base64-encoded signed Solana
transaction. GHOSTRAIL submits the lock and waits for `confirmed` status before
the resource handler is allowed to run. The transaction currently uses the
buyer as fee payer, so the buyer needs devnet SOL for fees and rent.

### 2. Verify and submit

The paid service forwards the `X-PAYMENT` header and expected payment terms to:

```text
POST /api
```

For a registered service, the x402 request body supplies the service ID and
timeout. The `X-PAYMENT` header contains this base64-encoded x402 v1 envelope:

```json
{
  "x402Version": 1,
  "scheme": "escrow",
  "network": "solana-devnet",
  "payload": { "transaction": "<base64 signed Solana transaction>" }
}
```

```json
{
  "serviceId": "<registered service UUID>",
  "maxTimeoutSeconds": 300
}
```

With manual terms, provide `seller`, `amount`, `mint`, and
`maxTimeoutSeconds` instead. Legacy JSON-body verification remains available for inspection, but does not submit a transaction.

Legacy JSON-body verification accepts a transaction field with either a registered service ID or explicit payment terms. It only verifies and does not submit the transaction, so it must not be used to gate a paid resource.

The x402 header path verifies, submits, confirms, and then checks the resulting
locked escrow before accepting payment. It never serves a resource for a
`Pre-submission` result. Verification checks:

- Transaction deserialization and signatures.
- Allowed programs only.
- Exactly one genuine escrow `lock` instruction.
- Expected seller, mint, and amount.
- Buyer signature.
- Escrow and vault PDA derivation.
- Timeout between 60 seconds and the requested `maxTimeoutSeconds` (up to 3,600).
- Fee payer is not used as an escrow authority.
- Compute-unit limits.
- Previously failed transaction status.
- Confirmed escrow account, vault ownership, vault mint, exact balance, and
  `Locked` state before accepting x402 payment.
- Database replay protection for accepted signatures.

### 3. Settle

After the real handler succeeds, the seller signs a release transaction and
sends it to the facilitator via:

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

The facilitator confirms the release before the paid service returns the
resource. The response includes `X-PAYMENT-RESPONSE`, a base64-encoded x402 v1
settlement receipt whose `transaction` is the confirmed release signature. If
the resource handler fails, the seller does not sign a release and the buyer
can refund the still-locked escrow after timeout.

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
| `POST` | `/api` | Verify a legacy JSON transaction, or accept `X-PAYMENT`, submit the lock, and wait for confirmation |
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
BUYER_PRIVATE_KEY=<base58-private-key>
SELLER_PRIVATE_KEY=<base58-private-key>
```

`SELLER_PRIVATE_KEY` must match the seller public key used by the paid service.
`BUYER_PRIVATE_KEY` is used by the Python demo. The buyer currently needs
devnet SOL for the lock transaction and account rent. Never commit or print
private-key or API-key values.

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

An automated client demonstrating the x402 buyer journey:
1. Calls the service and reads its HTTP 402 requirements.
2. Builds and signs the escrow lock without submitting it.
3. Retries with `X-PAYMENT`; the facilitator submits and confirms the lock.
4. Receives the resource and decodes the `X-PAYMENT-RESPONSE` settlement receipt.

```powershell
# Run with default prompt
python test/buyer-client.py

# Or pass a custom prompt
python test/buyer-client.py "Explain quantum computing in one sentence"

# Or pass a custom service URL and prompt
python test/buyer-client.py http://127.0.0.1:8080/chat "Hello world"
```

### 2. `test/lock-usdc.py` (Legacy Lock Helper)

A concise, single-purpose script (~65 lines) that locks USDC into escrow:

```powershell
# Lock 0.01 USDC for the default seller
python test/lock-usdc.py

# Or lock a specific amount for a custom seller
python test/lock-usdc.py <SELLER_PUBLIC_WALLET> 0.05
```

Outputs the confirmed Transaction signature, Escrow PDA, and Base64 transaction string.

### 3. `generate-keys.py` & `show-addresses.py`

- `python scripts/generate-keys.py`: Generates fresh facilitator and fee-payer keypairs for `.env`.
- `python scripts/show-addresses.py`: Reads `.env` and safely displays only the public addresses.

---

## Python NVIDIA service (`services/nvidia/service.py`)

A standalone reference API server demonstrating a paywalled AI service. It
wraps NVIDIA's OpenAI-compatible LLM endpoint behind GHOSTRAIL.

### Features
- **HTTP 402 Gating**: Returns x402 v1 requirements if called without `X-PAYMENT`.
- **Confirmed payment**: Forwards the x402 header to GHOSTRAIL, which submits and confirms the lock before the NVIDIA handler runs.
- **Automated settlement**: After a successful handler result, signs the release with `SELLER_PRIVATE_KEY` and submits it through GHOSTRAIL. The response includes `X-PAYMENT-RESPONSE` with the release signature.
- **Handler failures**: Do not trigger a release; the buyer can refund after the escrow timeout.

### Running the service

Set the NVIDIA API key and service terms in the constants near the top of
`services/nvidia/service.py`; that service does not read `.env`. Settlement
loads blockchain settings and signing keys from the repository-root `.env`,
regardless of the service's working directory. `SELLER_PRIVATE_KEY` must match
the configured `SELLER_WALLET` (the buyer key is used as the demo fallback if
it matches the seller). Then start the service:

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
- Legacy JSON-only `POST /api` verification does not submit or confirm buyer transactions. The x402 `X-PAYMENT` path does both before running the paid handler.
- The buyer pays the lock transaction fee and account rent; sponsored lock payments are not implemented in this flow.
- The NVIDIA demo returns the resource only after its seller-signed release is confirmed.
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
