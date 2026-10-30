# GHOSTRAIL Node.js SDK

The GHOSTRAIL Node.js SDK lets buyers call services that require USDC payment and lets sellers register service APIs.
It uses prepaid credit associated with the buyer and seller wallets.
Buyers can deposit credit for a seller and use it for multiple services with that seller wallet.
The SDK signs each service charge and returns the response and receipt details.
The Node.js client is implemented in `buyer.js` and exported as the package entry point.
Seller registration is implemented in `seller.js` and exported as `ghosrail-sdk/seller`.
The example scripts show how to call a service, check credit, deposit USDC, and withdraw unused credit.
Set the required wallet and program values in the repository-root `.env` before running the scripts.

## Setup

Install dependencies from the repository root:

```powershell
npm install --prefix ghostrail_sdk/node
```

Set `BUYER_PRIVATE_KEY` and `ESCROW_PROGRAM_ID` in the root `.env` file for buyer examples. Set `FACILITATOR_URL` if the facilitator is not running at `http://127.0.0.1:3000`.
Node 20.6 or newer can load it with `--env-file=.env`.

## Examples

Run these commands from the repository root:

```powershell
node --env-file=.env ghostrail_sdk/node/examples/call-service.mjs
```

Calls a paid service using prepaid credit. Prints the response, transaction,
API Endpoint, and service ID. Edit the endpoint and prompt in the script.

```powershell
node --env-file=.env ghostrail_sdk/node/examples/check-credit.mjs
```

Checks and prints available credit. Set the buyer and seller addresses at the
top of `check-credit.mjs`.

```powershell
node --env-file=.env ghostrail_sdk/node/examples/deposit-credit.mjs
```

Deposits USDC into credit for a seller. Set the seller address and amount at
the top of `deposit-credit.mjs`.

```powershell
node --env-file=.env ghostrail_sdk/node/examples/withdraw-credit.mjs
```

Withdraws the remaining credit for a seller. Set the seller address at the top
of `withdraw-credit.mjs`.

Register a service by editing the service name, API Endpoint, seller Solana wallet,
and devnet USDC price in `examples/register-service.mjs`, then run:

```powershell
node --env-file=.env ghostrail_sdk/node/examples/register-service.mjs
```

The API Endpoint must use HTTPS except for localhost development. The script prints
the service ID and one-time `deleteToken` returned by the facilitator. Keep the
token private; pass it to `new Seller().deleteService(serviceId, deleteToken)`
to delete that registration later. Edit the values in
`examples/delete-service.mjs` and run:

```powershell
node --env-file=.env ghostrail_sdk/node/examples/delete-service.mjs
```
