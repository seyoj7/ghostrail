# Ghostrail

**Self-hosted x402 payment facilitator for Solana devnet.**

Ghostrail enables AI agents and apps to pay for APIs using reusable prepaid USDC credit on Solana devnet. Buyers deposit once into a deterministic, non-custodial credit account, then sign a nonce-protected charge for each successful API request. Sellers integrate a standard HTTP 402 challenge/response flow and only charge after delivery succeeds.

> [!NOTE]
> **Devnet deployment.** Ghostrail and its Anchor escrow program are configured and audited for Solana devnet. Registered services are listed by sellers.

---

## Architecture & System Design

Ghostrail coordinates trustless, automated micropayments between autonomous agents (buyers), API services (sellers), and the Solana devnet blockchain.

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 1. CLIENT / AGENT TIER                                 │
│  [AI Agent / Buyer App] ──> [Ghostrail SDK (Node / Python)] ──> [Ed25519 Buyer Wallet] │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP / x402 Protocol
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              2. SELLER / RESOURCE PROVIDER                             │
│  [API Endpoint] ──> [x402 Middleware Challenge] ──> [Upstream Service]                 │
└──────────────────────┬─────────────────────────────────────────────────────────────────┘
                       │
       Payment Verify  │ Settle Charge
       & Auth Status   │ After Success
                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             3. GHOSTRAIL FACILITATOR TIER                              │
│  ┌───────────────────────┐  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │     API Gateways      │  │   Verification Engine   │  │   Settlement & Escrow    │  │
│  │  • POST /api          │  │  • verify.ts            │  │  • settlement.ts         │  │
│  │  • PUT /api           │  │  • prepaid.ts           │  │  • fee-sponsor.ts        │  │
│  │  • /api/services      │  │  • Disallowed Program   │  │  • refund-worker.ts      │  │
│  │  • Dashboard & UI     │  │    & Nonce Guard        │  │  • Facilitator Co-sign   │  │
│  └───────────┬───────────┘  └────────────┬────────────┘  └────────────┬─────────────┘  │
│              └───────────────────────────┼────────────────────────────┘                │
│                                          ▼                                             │
│                       ┌─────────────────────────────────────┐                          │
│                       │    PostgreSQL Database (Neon DB)    │                          │
│                       │  • seen_signatures (Anti-replay)    │                          │
│                       │  • payment_records (Audit logs)     │                          │
│                       │  • registered_services (Directory)  │                          │
│                       └──────────────────┬──────────────────┘                          │
└──────────────────────────────────────────┼─────────────────────────────────────────────┘
                                           │ Solana JSON-RPC
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                             4. SOLANA BLOCKCHAIN (DEVNET)                              │
│                                                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                   Anchor Program: Escrow & Prepaid Credit                        │  │
│  │  Instructions: [deposit_credit]  [charge_credit]  [withdraw_credit]  [lock]      │  │
│  └───────────────────────────────────────┬──────────────────────────────────────────┘  │
│                                          │                                             │
│          ┌───────────────────────────────┴───────────────────────────────┐             │
│          ▼                                                               ▼             │
│  ┌──────────────────────────────┐                            ┌──────────────────────┐  │
│  │          Credit PDA          │                            │      Escrow PDA      │  │
│  │ seeds: [credit, buyer,       │── controls vault ──►       │ seeds: [escrow,      │  │
│  │         seller, mint]        │                            │         buyer, id]   │  │
│  │ • balance    • next_nonce    │                            │ • timeout • state    │  │
│  └──────────────────────────────┘                            └──────────────────────┘  │
│                 │                                                        │             │
│                 └────────────────────────┬───────────────────────────────┘             │
│                                          ▼                                             │
│                          ┌───────────────────────────────┐                             │
│                          │      Vault Token Account      │                             │
│                          │ seeds: [vault, credit_or_pda] │                             │
│                          │ Holds Devnet USDC Tokens      │                             │
│                          └───────────────────────────────┘                             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Payment Flow & State Lifecycle

The complete transaction lifecycle proceeds across four deterministic phases:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               PHASE 1: ONE-TIME CREDIT DEPOSIT                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   [ Buyer Agent / App ]                                    [ Solana Devnet (Anchor) ]            │
│             │                                                          │                         │
│             ├─── 1. Build & sign deposit_credit tx ───────────────────►│                         │
│             │       (1 to 100 USDC deposit)                            │                         │
│             │                                                          ├── Transfers USDC        │
│             │                                                          │   into Vault PDA        │
│             │                                                          ├── Initializes Credit    │
│             │                                                          │   PDA with nextNonce=0  │
│             │◄── 2. Deposit confirmed (Credit PDA ready) ──────────────┤                         │
│                                                                                                  │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               PHASE 2: HTTP 402 NEGOTIATION                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   [ Buyer Agent / App ]                                    [ Seller Service Gateway ]            │
│             │                                                          │                         │
│             ├─── 1. POST /resource (e.g. prompt, no payment) ─────────►│                         │
│             │                                                          │                         │
│             │◄── 2. HTTP 402 Payment Required ─────────────────────────┤                         │
│             │       x402 challenge: price, seller wallet, asset mint,  │                         │
│             │       creditModel: "prepaid"                             │                         │
│                                                                                                  │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             PHASE 3: PRE-DELIVERY VERIFICATION                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   [ Buyer Agent ]            [ Seller Gateway ]             [ Facilitator ]         [ Solana ]   │
│          │                          │                              │                    │        │
│          ├── 1. Sign charge_credit  │                              │                    │        │
│          │      (amount + nonce)    │                              │                    │        │
│          │                          │                              │                    │        │
│          ├── 2. POST /resource ────►│                              │                    │        │
│          │      (X-PAYMENT header)  ├── 3. POST /api (verify) ────►│                    │        │
│          │                          │      (payment payload)       ├── 4. Anti-replay   │        │
│          │                          │                              │      DB check      │        │
│          │                          │                              ├── 5. Query PDA ───►│        │
│          │                          │                              │      (nonce/bal)   │        │
│          │                          │                              │◄── Verified ───────┤        │
│          │                          │◄── 6. HTTP 200 Accepted ─────┤                             │
│          │                          │       (authorized, unpaid)   │                             │
│                                                                                                  │
└────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 4: EXECUTION & POST-DELIVERY SETTLEMENT                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   [ Buyer Agent ]            [ Seller Gateway ]             [ Facilitator ]         [ Solana ]   │
│          │                          │                              │                    │        │
│          │                          ├── 1. Execute Service Handler │                    │        │
│          │                          │      (e.g., call NVIDIA API) │                    │        │
│          │                          │      • If failed: Stop here! │                    │        │
│          │                          │        (credit is untouched) │                    │        │
│          │                          │                              │                    │        │
│          │                          ├── 2. Handler Succeeded! ─────┼────────────────────┤        │
│          │                          │      PUT /api (action: charge)                    │        │
│          │                          │      (creditAddress, signature, tx)               │        │
│          │                          │                              ├── 3. Broadcast ───►│        │
│          │                          │                              │      charge_credit │        │
│          │                          │                              │      on-chain      ├── Deduct bal
│          │                          │                              │                    ├── Bump nonce
│          │                          │                              │◄── Confirmed ──────┤        │
│          │                          │                              ├── 4. Record to DB  │        │
│          │                          │◄── 5. Settled { signature } ─┤                             │
│          │                                                         │                             │
│          │◄── 6. HTTP 200 OK (API Result Payload) ─────────────────┤                             │
│          │       Header: X-PAYMENT-RESPONSE (confirmed tx hash)                                  │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### State Transition Lifecycle

```
       ┌───────────────┐
       │   UNFUNDED    │
       └───────┬───────┘
               │  deposit_credit (1-100 USDC)
               ▼
       ┌───────────────┐
  ┌───►│  ACTIVE POOL  │◄──────────────────────┐
  │    │  (In Vault)   │                       │
  │    └───────┬───────┘                       │
  │            │  POST /resource               │
  │            ▼  (X-PAYMENT charge signed)    │
  │    ┌───────────────┐                       │
  │    │  AUTHORIZED   │                       │
  │    └───────┬───────┘                       │
  │            │                               │
  │     Handler execution:                     │
  │            ├─────── Handler Fails ─────────┘ (No charge submitted;
  │            │                                  balance remains 100% intact)
  │            ▼ Handler Succeeds
  │    ┌───────────────┐
  │    │    SETTLED    │ ───► Funds moved to Seller Token Account
  │    └───────────────┘      Nonce incremented by 1
  │            │
  │            └─────────► Next request repeats from ACTIVE POOL
  │
  └──────────── withdraw_credit (Buyer can reclaim unused USDC at any time)
```

---

## Key Components

### On-Chain Program (`escrow/`)

An [Anchor](https://www.anchor-lang.com/) program deployed on Solana devnet with six instructions:

| Instruction       | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `lock`            | Lock USDC into a per-buyer escrow PDA with a timeout (60s–1hr) |
| `release`         | Seller confirms delivery → funds transfer to seller            |
| `refund`          | Buyer reclaims funds after timeout expires                     |
| `deposit_credit`  | Fund a reusable buyer↔seller credit account (1–100 USDC)       |
| `charge_credit`   | Deduct from credit with a buyer-signed nonce (per-call charge) |
| `withdraw_credit` | Buyer withdraws unused credit at any time                      |

**Account PDAs:**

- **Escrow:** `["escrow", buyer, escrow_id]` — per-transaction, one-time use
- **Credit:** `["credit", buyer, seller, mint]` — reusable, one per buyer/seller/mint
- **Vault:** `["vault", escrow_or_credit]` — token account holding locked USDC

### Facilitator Backend (`backend/`)

The Next.js server acts as a neutral facilitator:

- **`verify.ts`** — Validates buyer-signed escrow lock transactions: checks instruction shape, allowed programs, compute limits, timeout bounds, escrow funding, fee-payer isolation, and replay prevention.
- **`prepaid.ts`** — Validates prepaid charge authorizations, submits deposits, settles charges after handler success.
- **`settlement.ts`** — Co-signs and submits release/refund transactions with the facilitator keypair.
- **`escrow.ts`** — Reads on-chain escrow/credit accounts via Anchor.
- **`fee-sponsor.ts`** — Sponsors transaction fees so buyers don't need SOL for the escrow lock.
- **`refund-worker.ts`** — Background poller that auto-refunds expired escrows when seller services are unreachable.
- **`services.ts`** — Service registry CRUD with secret-token-protected deletion.
- **`db.ts`** — PostgreSQL persistence: schema auto-migration, payment records, signature dedup, service registry.

### API Routes (`app/api/`)

| Method   | Route                | Purpose                                                       |
| -------- | -------------------- | ------------------------------------------------------------- |
| `POST`   | `/api`               | Verify a buyer-signed payment (escrow lock or prepaid charge) |
| `PUT`    | `/api`               | Submit settlement (release, refund, deposit, or charge)       |
| `GET`    | `/api`               | Query payment by signature, escrow, credit, or list recent    |
| `GET`    | `/api/services`      | List all registered services                                  |
| `POST`   | `/api/services`      | Register a new service                                        |
| `GET`    | `/api/services/[id]` | Get service details + payment requirements                    |
| `DELETE` | `/api/services/[id]` | Delete a service (requires Bearer token)                      |

### Frontend (`app/`) 

- **Landing page** — Product overview, architecture features, and seller integration example
- **Dashboard** — Payment records and verified, rejected, and volume statistics
- **Services** — Service registration and deletion with a one-time delete token
- **Playground** — Inspect x402 payment challenges and try buyer-signed requests
- **Docs** — Integration guide for the x402 challenge → deposit → charge flow

### Client SDKs (`ghostrail_sdk/`)

Available in **Node.js** and **Python**:

| Operation              | Buyer              | Seller              |
| ---------------------- | ------------------ | ------------------- |
| Call a paid service    | `callService()`    | —                   |
| Deposit USDC credit    | `depositCredit()`  | —                   |
| Withdraw unused credit | `withdrawCredit()` | —                   |
| Check credit balance   | `checkCredit()`    | —                   |
| Register a service     | —                  | `registerService()` |
| Delete a service       | —                  | `deleteService()`   |

---

## Payment Models

### 1. Prepaid Credit (Primary)

The buyer deposits USDC into a reusable credit account bound to one seller wallet. Each API call uses a buyer-signed `charge_credit` instruction with an incrementing on-chain nonce. The charge is only submitted after the seller's handler succeeds, so failed deliveries don't cost anything.

### 2. Per-Request Escrow (Legacy)

The buyer locks USDC into a one-time escrow PDA with a timeout. The seller releases to claim payment; the buyer refunds after timeout. A fee-payer sponsors the lock transaction so the buyer doesn't need SOL.

---

## Security Properties

- **Non-custodial** — USDC is held in Anchor PDAs. The facilitator keypair cannot spend escrowed or credited funds without a buyer-signed or seller-signed transaction.
- **Fail-closed verification** — Every transaction instruction is audited for allowed programs, discriminator shapes, exact mint, seller, amount, account shapes, and compute limits.
- **Replay prevention** — Accepted signatures are indexed in PostgreSQL and checked against Solana signature status.
- **Nonce ordering** — Prepaid charges require the exact next on-chain nonce, preventing double-spend.
- **Fee-payer isolation** — The fee payer is blocked from appearing as an escrow authority.
- **Charge-after-delivery** — Sellers only submit the charge after their handler succeeds.
- **Withdrawable credit** — Buyers can withdraw unused USDC at any time via `withdraw_credit`.
- **Automatic refunds** — An optional background worker refunds timed-out escrows when seller services are unreachable.

---

## Quick Start

### Prerequisites

- Node.js ≥ 20.6
- PostgreSQL database
- Solana CLI + devnet SOL
- Anchor CLI (to build/deploy the escrow program)

## Tech Stack

| Layer      | Tech                                                          |
| ---------- | ------------------------------------------------------------- |
| Frontend   | Next.js 16, React 19, CSS (custom)                            |
| Backend    | Next.js API Routes, TypeScript, `server-only`                 |
| Database   | PostgreSQL (via `pg`)                                         |
| Blockchain | Solana devnet, Anchor, `@solana/web3.js`, `@solana/spl-token` |
| Protocol   | x402 v1 (HTTP 402 payment challenge/response)                 |
| SDKs       | Node.js (ESM), Python                                         |

---
