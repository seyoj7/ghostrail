from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable, cast
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Commitment
from solana.rpc.models import TxOpts
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
LAMPORTS_PER_SOL = 1_000_000_000
COMMITMENT = Commitment.CONFIRMED


def load_dotenv() -> None:
    """Load the repository-root .env without overwriting process values."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return

    for line in lines:
        match = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", line)
        if not match or os.environ.get(match.group(1)):
            continue
        os.environ[match.group(1)] = match.group(2).strip("'")


def required(name: str, value: str | None, *, command_line: bool = False) -> str:
    if not value:
        source = ".env or the command line" if command_line else ".env"
        raise ValueError(f"{name} is missing from {source}")
    return value


def load_keypair(name: str, value: str | None) -> Keypair:
    try:
        return Keypair.from_base58_string(required(name, value))
    except Exception as error:
        raise ValueError(f"{name} must be a valid base58 private key") from error


def base58_encode(value: bytes) -> str:
    number = int.from_bytes(value, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded
    leading_zeroes = len(value) - len(value.lstrip(b"\0"))
    return "1" * leading_zeroes + (encoded or "")


def account_meta(pubkey: Pubkey, *, signer: bool, writable: bool) -> AccountMeta:
    return AccountMeta(pubkey, is_signer=signer, is_writable=writable)


def instruction(
    program_id: Pubkey,
    data: bytes,
    accounts: Iterable[AccountMeta],
) -> Instruction:
    return Instruction(program_id, data, list(accounts))


def signed_transaction(
    instructions: list[Instruction],
    payer: Keypair,
    recent_blockhash: Hash,
) -> Transaction:
    message = Message(instructions, payer.pubkey())
    return Transaction([payer], message, recent_blockhash)


def partially_signed_transaction(
    instructions: list[Instruction],
    payer: Pubkey,
    authority: Keypair,
    recent_blockhash: Hash,
) -> Transaction:
    message = Message(instructions, payer)
    transaction = Transaction.new_unsigned(message)
    transaction.partial_sign([authority], recent_blockhash)
    return transaction


async def send_transaction(
    client: AsyncClient,
    transaction: Transaction,
) -> str:
    response = await client.send_raw_transaction(
        bytes(transaction),
        opts=TxOpts(
            skip_confirmation=False,
            preflight_commitment=COMMITMENT,
        ),
    )
    return str(response.value)


def facilitator_request(
    url: str,
    method: str,
    payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    return json_request(f"{url.rstrip('/')}/api", method, payload)


def json_request(
    url: str,
    method: str,
    payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    request = Request(
        url,
        method=method,
        headers={"Content-Type": "application/json"},
        data=json.dumps(payload).encode("utf-8"),
    )
    try:
        with urlopen(request, timeout=30) as response:
            status = response.status
            body = response.read()
    except HTTPError as error:
        status = error.code
        body = error.read()
    except URLError as error:
        raise RuntimeError(f"Facilitator request failed: {error.reason}") from error

    try:
        result = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Facilitator returned invalid JSON (HTTP {status})") from error
    if not isinstance(result, dict):
        raise RuntimeError("Facilitator returned a non-object JSON response")
    return status, result


def transaction_base64(transaction: Transaction) -> str:
    return base64.b64encode(bytes(transaction)).decode("ascii")


ESCROW_ACCOUNT_DISCRIMINATOR = bytes([31, 213, 123, 187, 186, 22, 218, 155])
RELEASE_DISCRIMINATOR = bytes([253, 249, 15, 206, 28, 127, 193, 241])
REFUND_DISCRIMINATOR = bytes([2, 96, 183, 251, 63, 208, 46, 46])


def parse_escrow(account: Any | None, address: str, program_id: Pubkey) -> dict[str, Any]:
    account_info = cast(Any, account)
    if account_info is None or account_info.owner != program_id:
        raise ValueError(f"Escrow account was not found at {address}")
    data = bytes(account_info.data)
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


async def ensure_token_account(
    client: AsyncClient,
    payer: Keypair,
    mint: Pubkey,
    owner: Pubkey,
) -> Pubkey:
    from spl.token.instructions import create_associated_token_account, get_associated_token_address
    address = get_associated_token_address(owner, mint)
    account_info = cast(Any, (await client.get_account_info(address, commitment=COMMITMENT)).value)
    if account_info is None:
        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
        tx = signed_transaction(
            [create_associated_token_account(payer.pubkey(), owner, mint)],
            payer,
            blockhash,
        )
        await send_transaction(client, tx)
    return address


async def settle_escrow_action(
    action: str,
    escrow_address_str: str,
    authority: Keypair | None = None,
) -> dict[str, Any]:
    """Settle an escrow on-chain by releasing to seller or refunding to buyer."""
    load_dotenv()
    from spl.token.constants import TOKEN_PROGRAM_ID
    import time

    rpc_url = required("SOLANA_RPC_URL", os.getenv("SOLANA_RPC_URL"))
    program_id = Pubkey.from_string(required("ESCROW_PROGRAM_ID", os.getenv("ESCROW_PROGRAM_ID")))
    expected_mint = Pubkey.from_string(required("USDC_MINT", os.getenv("USDC_MINT")))
    escrow_address = Pubkey.from_string(escrow_address_str)
    facilitator_url = os.getenv("FACILITATOR_URL", "http://localhost:3000")

    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        escrow = parse_escrow(
            cast(Any, (await client.get_account_info(escrow_address, commitment=COMMITMENT)).value),
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

        if authority is None:
            if action == "refund":
                authority = load_keypair("BUYER_PRIVATE_KEY", os.getenv("BUYER_PRIVATE_KEY"))
                if authority.pubkey() != buyer:
                    raise ValueError("BUYER_PRIVATE_KEY does not match the escrow buyer")
            elif os.getenv("SELLER_PRIVATE_KEY"):
                authority = load_keypair("SELLER_PRIVATE_KEY", os.getenv("SELLER_PRIVATE_KEY"))
            elif os.getenv("BUYER_PRIVATE_KEY"):
                authority = load_keypair("BUYER_PRIVATE_KEY", os.getenv("BUYER_PRIVATE_KEY"))
            else:
                raise ValueError("A signing key is required for settlement")

        expected_authority = seller if action == "release" else buyer
        if authority.pubkey() != expected_authority:
            role = "seller" if action == "release" else "buyer"
            raise ValueError(f"Signing key {authority.pubkey()} does not match escrow {role} {expected_authority}")

        facilitator_value = os.getenv("FACILITATOR_PUBLIC_KEY")
        facilitator = (
            Pubkey.from_string(facilitator_value)
            if facilitator_value
            else load_keypair("FACILITATOR_PRIVATE_KEY", os.getenv("FACILITATOR_PRIVATE_KEY")).pubkey()
        )
        if authority.pubkey() == facilitator:
            raise ValueError("The facilitator cannot be the escrow authority")

        recipient = seller if action == "release" else buyer
        recipient_token = await ensure_token_account(client, authority, mint, recipient)
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

        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
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
    if status < 200 or status >= 300 or result.get("success") is not True:
        raise RuntimeError(f"Settlement failed: {result}")
    return result


def run(coroutine: Any) -> None:
    try:
        asyncio.run(coroutine)
    except Exception as error:
        print(str(error), file=__import__("sys").stderr)
        raise SystemExit(1) from error
