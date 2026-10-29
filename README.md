# GHOSTRAIL

GHOSTRAIL is a self-hosted, devnet-only payment facilitator prototype for
x402-style USDC payments on Solana.

The service demo follows the x402 v1 HTTP header flow with a custom `escrow` scheme
and reusable prepaid credit:

1. A request without `X-PAYMENT` receives HTTP 402 with the per-call price and allowed deposit range.
2. The buyer deposits 1–100 USDC once into a buyer/seller credit account. Repeated requests reuse its remaining balance.
3. For each request, the buyer signs a charge authorization containing the exact price and an on-chain nonce.
4. The service runs its real handler, then GHOSTRAIL submits and confirms that charge before returning the resource and `X-PAYMENT-RESPONSE` receipt.
5. If the handler fails, the charge is not submitted and the prepaid balance is unchanged. The buyer can withdraw unused credit at any time.

The buyer pays transaction fees and account rent in devnet SOL. GHOSTRAIL does not
custody escrowed USDC: the Anchor program controls the prepaid credit vault PDA.

> **Status:** This is an unaudited Solana devnet prototype. It is not a
> production payment facilitator or delivery oracle. The escrow scheme is
> custom and is not compatible with the built-in exact-transfer SVM scheme.
> Do not use real funds or deploy the program to mainnet.

## Architecture

```text
Buyer / AI agent
      |
      | 1. Discovers price via HTTP 402 or GET /api/services/:id
      | 2. Deposits credit once; signs per-call charge; retries with X-PAYMENT
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
      | 4. Verifies credit and charge nonce before handler execution
      v
PostgreSQL (Audit log & Replay protection)
      |
      | 5. Service handler runs before a charge is submitted
      v
Buyer-signed charge submitted after handler success
      |
      v
Solana devnet
      |
      v
Anchor escrow program
      |
      +--> USDC charged to seller from reusable credit
      |
      +--> Unused USDC remains withdrawable by buyer
```

### Application layer

- [`app/`](./app/) contains the Next.js App Router UI and route handlers.
- `/` explains the system and shows the seller integration example.
- `/dashboard` displays recent accepted and rejected verification records.
- `/services` registers seller endpoints, wallets, and prices (generates Service IDs).
- `/docs` describes prepaid credit, per-call authorization, and withdrawal.

### Backend layer

- [`backend/api.ts`](./backend/api.ts) implements the `/api` handlers.
- [`backend/verify.ts`](./backend/verify.ts) validates the legacy single-call lock flow.
- [`backend/prepaid.ts`](./backend/prepaid.ts) validates buyer-signed charges, submits deposits and successful charges, and reads credit accounts.
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

[`escrow/src/lib.rs`](./escrow/src/lib.rs) is the Rust/Anchor program. It keeps
the original single-call lock instructions and adds reusable buyer/seller credit:

```text
deposit 1–100 USDC (maximum balance 100 USDC)
charge exact service price + sequential nonce
withdraw remaining balance at any time
```

The deterministic credit PDA owns a vault PDA. Each charge requires the buyer's
signature and is limited to the stored seller and mint. The facilitator cannot
authorize charges or withdrawals by itself.

## Payment lifecycle

### 1. Discover price and create credit once

The buyer calls the paid endpoint without `X-PAYMENT`. The HTTP 402 `accepts`
entry contains the per-call price, seller, USDC mint, program ID, and prepaid
deposit bounds in `extra`:

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "escrow",
    "network": "solana-devnet",
    "maxAmountRequired": "10000",
    "resource": "http://127.0.0.1:8080/chat",
    "description": "Charge from reusable GHOSTRAIL USDC credit",
    "mimeType": "application/json",
    "payTo": "<seller public key>",
    "asset": "<USDC mint>",
    "extra": {
      "escrowProgramId": "<escrow program ID>",
      "creditModel": "prepaid",
      "minDepositAmount": "1000000",
      "maxBalanceAmount": "100000000"
    }
  }]
}
```

Amounts use USDC's six-decimal base units. Each deposit must be 1–100 USDC,
and the combined credit balance for a buyer/seller/mint cannot exceed 100 USDC.
The credit PDA is deterministic:

```text
["credit", buyer public key, seller public key, mint]
```

The buyer signs `deposit_credit` once (and can top up later). The facilitator
confirms the deposit before the buyer retries. Repeated calls reuse the same
credit account and vault.

### 2. Authorize each call

For each call, the buyer signs a `charge_credit` instruction containing the
per-call amount and the credit account's next nonce. Its x402 v1 header carries
the signed transaction:

```json
{
  "x402Version": 1,
  "scheme": "escrow",
  "network": "solana-devnet",
  "payload": { "transaction": "<base64 buyer-signed charge transaction>" }
}
```

The seller forwards it to `POST /api` with `serviceId` (or explicit seller,
amount, and mint). The facilitator verifies buyer signature, seller and mint,
price, credit/vault addresses, nonce, on-chain balance, and transaction replay
protection. This step does not submit the charge, so the service can still run
before funds are deducted.

### 3. Run handler and charge only on success

After the real handler succeeds, the seller submits the verified buyer
authorization to `PUT /api` with `action: "charge"`. GHOSTRAIL submits and
confirms the transaction, which transfers the service price from the credit
vault to the seller and increments the nonce. The resource is returned only
after confirmation, along with an `X-PAYMENT-RESPONSE` receipt containing the
charge signature. If the handler fails, no charge transaction is submitted and
the buyer's credit remains unchanged.

The buyer may withdraw any unused amount at any time with `withdraw_credit`.
The buyer signs and pays SOL fees for deposits, charges, and withdrawals. The
facilitator cannot spend credit without a buyer-signed charge transaction.

## API reference

### Payment and escrow API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/api` | Verify a legacy lock or a buyer-signed prepaid charge authorization |
| `PUT` | `/api` | Submit a buyer-signed credit deposit or post-handler charge; legacy release/refund remain available |
| `GET` | `/api` | Return the 50 newest payment records |
| `GET` | `/api?signature=...` | Find a payment record by signature |
| `GET` | `/api?escrowAddress=...` | Read an escrow account from Solana |
| `GET` | `/api?creditAddress=...` | Read a reusable prepaid credit balance from Solana |

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
`BUYER_PRIVATE_KEY` is used by the Python demo. The buyer needs devnet SOL for
deposit, charge, and withdrawal transaction fees and account rent. Never commit or print
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
The prepaid-credit instructions change the on-chain program; deploy the updated
program to devnet before using the new buyer client.

---

## Python scripts suite

Install dependencies:

```powershell
python -m pip install -r scripts/requirements.txt
```

### 1. `buyer-client.py` (Recommended Buyer Flow)

An automated client demonstrating the x402 buyer journey:
1. Calls the service and reads its HTTP 402 requirements.
2. Checks that the buyer has enough prepaid credit for the requested call.
3. Signs a nonce-protected charge for this call and retries with `X-PAYMENT`.
4. Receives the resource only after the handler succeeds and the charge is confirmed.
5. Reuses the remaining balance on later calls.

```powershell
# Run with default prompt
python test/buyer-client.py

# Or pass a custom prompt
python test/buyer-client.py "Explain quantum computing in one sentence"

# Or pass a custom service URL and prompt
python test/buyer-client.py http://127.0.0.1:8080/chat "Hello world"
```

Deposit prepaid credit separately (amount defaults to 1 USDC and must be between
1 and 100 USDC):

```powershell
python test/deposit-credit.py <SELLER_PUBLIC_KEY> 1
```

The buyer client does not deposit automatically. It reports insufficient credit
and shows the deposit command when the balance is too low.

Check the current prepaid balance for a seller with:

```powershell
python test/check-credit.py <SELLER_PUBLIC_KEY>
```

This reports reusable prepaid credit; it does not include USDC in a legacy lock.

Withdraw unused prepaid credit with the separate script (this does not contact the service):

```powershell
python test/withdraw-credit.py <SELLER_PUBLIC_KEY>
```

The script creates the buyer's USDC associated token account if it is missing,
then submits a buyer-signed withdrawal. The buyer needs devnet SOL for transaction
fees and, when needed, the token account's rent.

### 2. `test/lock-usdc.py` (Legacy Lock Helper)

A concise, single-purpose script (~65 lines) that locks USDC into escrow:

```powershell
# Lock 0.01 USDC for the default seller
python test/lock-usdc.py

# Or lock a specific amount for a custom seller
python test/lock-usdc.py <SELLER_PUBLIC_WALLET> 0.05
```

Outputs the confirmed Transaction signature, Escrow PDA, and Base64 transaction string.
The buyer can refund a legacy lock after its timeout (five minutes in this demo)
with the same buyer key used to create it:

```powershell
python test/refund-escrow.py <ESCROW_PDA>
```

Set `BUYER_PRIVATE_KEY` in the repository-root `.env` first. This refunds only
the legacy lock; use `python test/withdraw-credit.py <SELLER_PUBLIC_KEY>` to
withdraw unused prepaid credit.

### 3. `generate-keys.py` & `show-addresses.py`

- `python scripts/generate-keys.py`: Generates fresh facilitator and fee-payer keypairs for `.env`.
- `python scripts/show-addresses.py`: Reads `.env` and safely displays only the public addresses.

---

## Python NVIDIA service (`services/nvidia/service.py`)

A standalone reference API server demonstrating a paywalled AI service. It
wraps NVIDIA's OpenAI-compatible LLM endpoint behind GHOSTRAIL.

### Features
- **HTTP 402 Gating**: Returns x402 v1 requirements if called without `X-PAYMENT`.
- **Reusable payment**: Buyers deposit USDC once, then authorize each call with a buyer-signed, nonce-protected charge.
- **Automated charge**: The service runs the NVIDIA handler first, then submits the charge through GHOSTRAIL. The response includes `X-PAYMENT-RESPONSE` with the confirmed charge signature.
- **Handler failures**: Do not trigger a charge; the prepaid balance remains unchanged and is withdrawable by the buyer.

### Running the service

Set the NVIDIA API key and service terms in the constants near the top of
`services/nvidia/service.py`. The service reads `ESCROW_PROGRAM_ID` from the
repository-root `.env` so its payment challenge matches the facilitator. The
facilitator loads its blockchain settings and signs no buyer authorization;
the buyer's signed charge is submitted only after successful delivery. Then
start the service:

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
- Legacy one-call escrow helpers remain available. The prepaid x402 flow verifies a charge before running the handler and submits it only after handler success.
- The buyer pays the deposit, charge, and account rent in devnet SOL; charge fee sponsorship is not implemented.
- The NVIDIA demo returns the resource only after its buyer-authorized charge is confirmed.
- Service registrations do not verify endpoint or wallet ownership.
- Fee sponsorship helpers exist, but the complete sponsored lock flow is not
  wired into the main API.
- The automatic refund worker is a demonstration mechanism, not a delivery
  oracle.
- There is currently no `/attack-lab` implementation in the repository.

## Development commands

```powershell
npm run dev
npm run build
npm run lint
cargo check --manifest-path escrow/Cargo.toml
```
