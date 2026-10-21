from __future__ import annotations

import json
import os
import sys
import time

from solana.rpc.async_api import AsyncClient
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import create_associated_token_account, get_associated_token_address

from ghostrail_common import (
    COMMITMENT,
    account_meta,
    facilitator_request,
    instruction,
    load_dotenv,
    load_keypair,
    partially_signed_transaction,
    required,
    run,
    send_transaction,
    signed_transaction,
    transaction_base64,
)

ESCROW_ACCOUNT_DISCRIMINATOR = bytes([31, 213, 123, 187, 186, 22, 218, 155])
RELEASE_DISCRIMINATOR = bytes([253, 249, 15, 206, 28, 127, 193, 241])
REFUND_DISCRIMINATOR = bytes([2, 96, 183, 251, 63, 208, 46, 46])


def parse_escrow(account: object | None, address: str, program_id: Pubkey) -> dict[str, object]:
    if account is None or account.owner != program_id:
        raise ValueError(f"Escrow account was not found at {address}")
    data = bytes(account.data)
    if len(data) < 130:
        raise ValueError(f"Escrow account was not found at {address}")
    if data[:8] != ESCROW_ACCOUNT_DISCRIMINATOR:
        raise ValueError("The address is not a GHOSTRAIL escrow account")
    return {
        "buyer": Pubkey.from_bytes(data[8:40]),
        "seller": Pubkey.from_bytes(data[40:72]),
        "mint": Pubkey.from_bytes(data[72:104]),
        "timeout": int.from_bytes(data[112:120], "little", signed=True),
        "state": data[128],
    }


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
    action = sys.argv[1] if len(sys.argv) > 1 else None
    escrow_value = sys.argv[2] if len(sys.argv) > 2 else None
    if action not in ("release", "refund"):
        raise ValueError("Usage: python scripts/settle-demo-payment.py <release|refund> <ESCROW_ADDRESS>")

    rpc_url = required("SOLANA_RPC_URL", os.getenv("SOLANA_RPC_URL"))
    program_id = Pubkey.from_string(required("ESCROW_PROGRAM_ID", os.getenv("ESCROW_PROGRAM_ID")))
    expected_mint = Pubkey.from_string(required("USDC_MINT", os.getenv("USDC_MINT")))
    escrow_address = Pubkey.from_string(required("ESCROW_ADDRESS", escrow_value, command_line=True))
    facilitator_url = os.getenv("FACILITATOR_URL", "http://localhost:3000")

    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        escrow = parse_escrow(
            (await client.get_account_info(escrow_address, commitment=COMMITMENT)).value,
            str(escrow_address),
            program_id,
        )
        buyer = escrow["buyer"]
        seller = escrow["seller"]
        mint = escrow["mint"]
        timeout = escrow["timeout"]
        if escrow["state"] != 0:
            raise ValueError("Escrow is not Locked; it may already be released or refunded")
        if mint != expected_mint:
            raise ValueError("Escrow mint does not match USDC_MINT")
        if action == "refund" and int(time.time()) < timeout:
            raise ValueError(f"Refund is not available for {timeout - int(time.time())} more seconds")

        if action == "refund":
            authority = load_keypair("BUYER_PRIVATE_KEY", os.getenv("BUYER_PRIVATE_KEY"))
            if authority.pubkey() != buyer:
                raise ValueError("BUYER_PRIVATE_KEY does not match the escrow buyer")
        elif os.getenv("SELLER_PRIVATE_KEY"):
            authority = load_keypair("SELLER_PRIVATE_KEY", os.getenv("SELLER_PRIVATE_KEY"))
        elif seller == buyer:
            authority = load_keypair("BUYER_PRIVATE_KEY", os.getenv("BUYER_PRIVATE_KEY"))
        else:
            raise ValueError("SELLER_PRIVATE_KEY is required to release to a different seller")

        expected_authority = seller if action == "release" else buyer
        if authority.pubkey() != expected_authority:
            role = "seller" if action == "release" else "buyer"
            raise ValueError(f"The signing key does not match the escrow {role}")

        facilitator_value = os.getenv("FACILITATOR_PUBLIC_KEY")
        facilitator = (
            Pubkey.from_string(facilitator_value)
            if facilitator_value
            else load_keypair("FACILITATOR_PRIVATE_KEY", os.getenv("FACILITATOR_PRIVATE_KEY")).pubkey()
        )
        if authority.pubkey() == facilitator:
            raise ValueError("The facilitator cannot be the escrow authority")

        recipient = seller if action == "release" else buyer
        recipient_token = await ensure_associated_token_account(client, authority, mint, recipient)
        vault, _ = Pubkey.find_program_address([b"vault", bytes(escrow_address)], program_id)
        if action == "release":
            settlement_instruction = instruction(
                program_id,
                RELEASE_DISCRIMINATOR,
                [
                    account_meta(buyer, signer=False, writable=True),
                    account_meta(seller, signer=True, writable=False),
                    account_meta(mint, signer=False, writable=False),
                    account_meta(escrow_address, signer=False, writable=True),
                    account_meta(vault, signer=False, writable=True),
                    account_meta(recipient_token, signer=False, writable=True),
                    account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False),
                ],
            )
        else:
            settlement_instruction = instruction(
                program_id,
                REFUND_DISCRIMINATOR,
                [
                    account_meta(buyer, signer=True, writable=True),
                    account_meta(mint, signer=False, writable=False),
                    account_meta(escrow_address, signer=False, writable=True),
                    account_meta(vault, signer=False, writable=True),
                    account_meta(recipient_token, signer=False, writable=True),
                    account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False),
                ],
            )
        blockhash = (await client.get_latest_blockhash(commitment=COMMITMENT)).value.blockhash
        transaction = partially_signed_transaction(
            [settlement_instruction],
            facilitator,
            authority,
            blockhash,
        )

    status, result = facilitator_request(
        facilitator_url,
        "PUT",
        {
            "escrowAddress": str(escrow_address),
            "action": action,
            "transaction": transaction_base64(transaction),
        },
    )
    print(f"Settlement: {json.dumps(result)}")
    if status < 200 or status >= 300 or result.get("success") is not True:
        raise RuntimeError("Settlement failed")


if __name__ == "__main__":
    run(main())
