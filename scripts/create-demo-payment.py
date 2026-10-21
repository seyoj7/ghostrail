from __future__ import annotations

import json
import os
import re
import sys
import secrets
import time

from solana.rpc.async_api import AsyncClient
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import create_associated_token_account, get_associated_token_address

from ghostrail_common import (
    COMMITMENT,
    LAMPORTS_PER_SOL,
    account_meta,
    facilitator_request,
    instruction,
    load_dotenv,
    load_keypair,
    required,
    run,
    send_transaction,
    signed_transaction,
    transaction_base64,
)

USDC_DECIMALS = 6
LOCK_DISCRIMINATOR = bytes([21, 19, 208, 43, 237, 62, 255, 87])


def parse_amount(value: str) -> int:
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?", value):
        raise ValueError("Payment amount must be a positive USDC value with up to 6 decimals")
    whole, _, fraction = value.partition(".")
    amount = int(whole) * 10**USDC_DECIMALS + int(fraction.ljust(USDC_DECIMALS, "0") or 0)
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero")
    return amount


async def ensure_associated_token_account(
    client: AsyncClient,
    payer: Keypair,
    mint: Pubkey,
    owner: Pubkey,
) -> Pubkey:
    address = get_associated_token_address(owner, mint)
    if (await client.get_account_info(address, commitment=COMMITMENT)).value is None:
        blockhash = (await client.get_latest_blockhash(commitment=COMMITMENT)).value.blockhash
        transaction = signed_transaction(
            [create_associated_token_account(payer.pubkey(), owner, mint)],
            payer,
            blockhash,
        )
        await send_transaction(client, transaction)
    return address


async def main() -> None:
    load_dotenv()
    rpc_url = required("SOLANA_RPC_URL", os.getenv("SOLANA_RPC_URL"))
    program_id = Pubkey.from_string(required("ESCROW_PROGRAM_ID", os.getenv("ESCROW_PROGRAM_ID")))
    mint = Pubkey.from_string(required("USDC_MINT", os.getenv("USDC_MINT")))
    facilitator_url = os.getenv("FACILITATOR_URL", "http://localhost:3000")
    seller_value = os.getenv("SELLER_WALLET") or (sys.argv[1] if len(sys.argv) > 1 else None)
    amount_value = os.getenv("PAYMENT_AMOUNT_USDC") or (sys.argv[2] if len(sys.argv) > 2 else "0.01")
    seller = Pubkey.from_string(required("SELLER_WALLET", seller_value, command_line=True))
    amount = parse_amount(amount_value)
    buyer = load_keypair("BUYER_PRIVATE_KEY", os.getenv("BUYER_PRIVATE_KEY"))

    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        if (await client.get_balance(buyer.pubkey(), commitment=COMMITMENT)).value < int(0.01 * LAMPORTS_PER_SOL):
            raise ValueError("Buyer wallet needs at least 0.01 devnet SOL for account rent and transaction fees")

        escrow_id = secrets.randbits(64)
        timeout = int(time.time()) + 300
        escrow_id_bytes = escrow_id.to_bytes(8, "little")
        escrow, _ = Pubkey.find_program_address(
            [b"escrow", bytes(buyer.pubkey()), escrow_id_bytes],
            program_id,
        )
        vault, _ = Pubkey.find_program_address([b"vault", bytes(escrow)], program_id)
        buyer_token = await ensure_associated_token_account(client, buyer, mint, buyer.pubkey())
        balance = (await client.get_token_account_balance(buyer_token, commitment=COMMITMENT)).value.amount
        if int(balance) < amount:
            raise ValueError("Buyer wallet does not have enough devnet USDC for this payment")

        data = bytearray(32)
        data[:8] = LOCK_DISCRIMINATOR
        data[8:16] = escrow_id.to_bytes(8, "little")
        data[16:24] = amount.to_bytes(8, "little")
        data[24:32] = timeout.to_bytes(8, "little", signed=True)
        lock_instruction = instruction(
            program_id,
            bytes(data),
            [
                account_meta(buyer.pubkey(), signer=True, writable=False),
                account_meta(buyer.pubkey(), signer=True, writable=True),
                account_meta(seller, signer=False, writable=False),
                account_meta(mint, signer=False, writable=False),
                account_meta(escrow, signer=False, writable=True),
                account_meta(buyer_token, signer=False, writable=True),
                account_meta(vault, signer=False, writable=True),
                account_meta(SYSTEM_PROGRAM_ID, signer=False, writable=False),
                account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False),
            ],
        )
        blockhash = (await client.get_latest_blockhash(commitment=COMMITMENT)).value.blockhash
        transaction = signed_transaction([lock_instruction], buyer, blockhash)
        signature = await send_transaction(client, transaction)

    status, verification = facilitator_request(
        facilitator_url,
        "POST",
        {
            "transaction": transaction_base64(transaction),
            "seller": str(seller),
            "amount": str(amount),
            "mint": str(mint),
        },
    )
    print("On-chain payment submitted.")
    print(f"Transaction: {signature}")
    print(f"Escrow: {escrow}")
    print(f"Verification: {json.dumps(verification)}")
    if status < 200 or status >= 300 or verification.get("accepted") is not True:
        raise RuntimeError("Payment reached the chain but facilitator verification failed")


if __name__ == "__main__":
    run(main())
