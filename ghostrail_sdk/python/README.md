# GHOSTRAIL Python SDK

The GHOSTRAIL Python SDK lets buyers call services that require USDC payment and lets sellers register service APIs. Buyers use prepaid credit associated with buyer and seller wallets. The buyer client is implemented in `buyer.py`; the seller registration helper is in `seller.py`. Service registration stores the service name, API Endpoint, seller wallet, and price with the facilitator. It does not verify API or wallet ownership.

## Setup

Install dependencies from the repository root:

```powershell
python -m pip install -e .
```

Set `BUYER_PRIVATE_KEY` and `ESCROW_PROGRAM_ID` in the root `.env` file for buyer examples. Set `FACILITATOR_URL` if the facilitator is not running at `http://127.0.0.1:3000`.

## Examples

Run each command from the repository root:

```powershell
python ghostrail_sdk/python/examples/call_service.py
```

Calls a paid service using prepaid credit. Prints the response, transaction,
API Endpoint, and service ID. Edit the endpoint and prompt in the script.

```powershell
python ghostrail_sdk/python/examples/check_credit.py
```

Checks and prints the available credit. Edit the buyer and seller addresses
in the script.

```powershell
python ghostrail_sdk/python/examples/deposit_credit.py
```

Deposits USDC into credit for a seller. Edit the seller address and deposit
amount in the script.

```powershell
python ghostrail_sdk/python/examples/withdraw_credit.py
```

Withdraws the remaining credit for a seller. Edit the seller address in the
script.

```powershell
python ghostrail_sdk/python/examples/register_service.py
```

Register a service by editing the service name, API Endpoint, seller Solana wallet,
and devnet USDC price in `examples/register_service.py`.

The API Endpoint must use HTTPS except for localhost development. The script prints
the service ID and one-time `deleteToken` returned by the facilitator. Keep the
token private; pass it to `Seller().delete_service(service_id, delete_token)`
to delete that registration later. Edit the values in
`examples/delete_service.py` and run:

```powershell
python ghostrail_sdk/python/examples/delete_service.py
```
