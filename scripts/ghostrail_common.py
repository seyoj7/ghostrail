from __future__ import annotations

import asyncio
import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from solana.rpc.async_api import AsyncClient
from solana.rpc.models import TxOpts
from solders.hash import Hash
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.transaction import Transaction

BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
LAMPORTS_PER_SOL = 1_000_000_000
COMMITMENT = "confirmed"


def load_dotenv() -> None:
    """Load a simple root .env without overwriting process environment values."""
    env_path = Path.cwd() / ".env"
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
    request = Request(
        f"{url.rstrip('/')}/api",
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


def run(coroutine: Any) -> None:
    try:
        asyncio.run(coroutine)
    except Exception as error:
        print(str(error), file=__import__("sys").stderr)
        raise SystemExit(1) from error
