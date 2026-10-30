from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import sys
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
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction
from spl.token.constants import ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID
from spl.token.instructions import get_associated_token_address

BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

LAMPORTS_PER_SOL = 1000000000

COMMITMENT = Commitment.CONFIRMED

def load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[2] / '.env'
    try:
        lines = env_path.read_text(encoding='utf-8').splitlines()
    except OSError:
        return
    for line in lines:
        match = re.match('^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$', line)
        if not match or os.environ.get(match.group(1)):
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and (value[0] in '"\''):
            value = value[1:-1]
        os.environ[match.group(1)] = value

def required(name: str, value: str | None, *, command_line: bool=False) -> str:
    if not value:
        source = '.env or the command line' if command_line else '.env'
        raise ValueError(f'{name} is missing from {source}')
    return value

def load_keypair(name: str, value: str | None) -> Keypair:
    try:
        return Keypair.from_base58_string(required(name, value))
    except Exception as error:
        raise ValueError(f'{name} must be a valid base58 private key') from error

def base58_encode(value: bytes) -> str:
    number = int.from_bytes(value, 'big')
    encoded = ''
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded
    leading_zeroes = len(value) - len(value.lstrip(b'\x00'))
    return '1' * leading_zeroes + (encoded or '')

def account_meta(pubkey: Pubkey, *, signer: bool, writable: bool) -> AccountMeta:
    return AccountMeta(pubkey, is_signer=signer, is_writable=writable)

def instruction(program_id: Pubkey, data: bytes, accounts: Iterable[AccountMeta]) -> Instruction:
    return Instruction(program_id, data, list(accounts))

def signed_transaction(instructions: list[Instruction], payer: Keypair, recent_blockhash: Hash) -> Transaction:
    message = Message(instructions, payer.pubkey())
    return Transaction([payer], message, recent_blockhash)

def partially_signed_transaction(instructions: list[Instruction], payer: Pubkey, authority: Keypair, recent_blockhash: Hash) -> Transaction:
    message = Message(instructions, payer)
    transaction = Transaction.new_unsigned(message)
    transaction.partial_sign([authority], recent_blockhash)
    return transaction

async def send_transaction(client: AsyncClient, transaction: Transaction) -> str:
    response = await client.send_raw_transaction(bytes(transaction), opts=TxOpts(skip_confirmation=False, preflight_commitment=COMMITMENT))
    return str(response.value)

def facilitator_request(url: str, method: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    return json_request(f"{url.rstrip('/')}/api", method, payload)

def json_request(url: str, method: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    request = Request(url, method=method, headers={'Content-Type': 'application/json'}, data=json.dumps(payload).encode('utf-8'))
    try:
        with urlopen(request, timeout=30) as response:
            status = response.status
            body = response.read()
    except HTTPError as error:
        status = error.code
        body = error.read()
    except URLError as error:
        raise RuntimeError(f'Facilitator request failed: {error.reason}') from error
    try:
        result = json.loads(body.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f'Facilitator returned invalid JSON (HTTP {status})') from error
    if not isinstance(result, dict):
        raise RuntimeError('Facilitator returned a non-object JSON response')
    return (status, result)

def transaction_base64(transaction: Transaction) -> str:
    return base64.b64encode(bytes(transaction)).decode('ascii')

ESCROW_ACCOUNT_DISCRIMINATOR = bytes([31, 213, 123, 187, 186, 22, 218, 155])

RELEASE_DISCRIMINATOR = bytes([253, 249, 15, 206, 28, 127, 193, 241])

REFUND_DISCRIMINATOR = bytes([2, 96, 183, 251, 63, 208, 46, 46])

def parse_escrow(account: Any | None, address: str, program_id: Pubkey) -> dict[str, Any]:
    account_info = cast(Any, account)
    if account_info is None or account_info.owner != program_id:
        raise ValueError(f'Escrow account was not found at {address}')
    data = bytes(account_info.data)
    if len(data) < 130:
        raise ValueError(f'Escrow account was not found at {address}')
    if data[:8] != ESCROW_ACCOUNT_DISCRIMINATOR:
        raise ValueError('The address is not a GHOSTRAIL escrow account')
    return {'buyer': Pubkey.from_bytes(data[8:40]), 'seller': Pubkey.from_bytes(data[40:72]), 'mint': Pubkey.from_bytes(data[72:104]), 'timeout': int.from_bytes(data[112:120], 'little', signed=True), 'state': data[128]}

async def ensure_token_account(client: AsyncClient, payer: Keypair, mint: Pubkey, owner: Pubkey) -> Pubkey:
    from spl.token.instructions import create_associated_token_account, get_associated_token_address
    address = get_associated_token_address(owner, mint)
    account_info = cast(Any, (await client.get_account_info(address, commitment=COMMITMENT)).value)
    if account_info is None:
        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
        tx = signed_transaction([create_associated_token_account(payer.pubkey(), owner, mint)], payer, blockhash)
        await send_transaction(client, tx)
    return address

async def settle_escrow_action(action: str, escrow_address_str: str, authority: Keypair | None=None) -> dict[str, Any]:
    load_dotenv()
    from spl.token.constants import TOKEN_PROGRAM_ID
    import time
    rpc_url = os.getenv('SOLANA_RPC_URL', DEFAULT_SOLANA_RPC_URL)
    program_id = Pubkey.from_string(required('ESCROW_PROGRAM_ID', os.getenv('ESCROW_PROGRAM_ID')))
    expected_mint = Pubkey.from_string(required('USDC_MINT', os.getenv('USDC_MINT')))
    escrow_address = Pubkey.from_string(escrow_address_str)
    facilitator_url = os.getenv('FACILITATOR_URL', 'http://localhost:3000')
    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        escrow = parse_escrow(cast(Any, (await client.get_account_info(escrow_address, commitment=COMMITMENT)).value), str(escrow_address), program_id)
        buyer = escrow['buyer']
        seller = escrow['seller']
        mint = escrow['mint']
        timeout = escrow['timeout']
        if escrow['state'] != 0:
            raise ValueError('Escrow is not Locked; it may already be released or refunded')
        if mint != expected_mint:
            raise ValueError('Escrow mint does not match USDC_MINT')
        if action == 'refund' and int(time.time()) < timeout:
            raise ValueError(f'Refund is not available for {timeout - int(time.time())} more seconds')
        if authority is None:
            if action == 'refund':
                authority = load_keypair('BUYER_PRIVATE_KEY', os.getenv('BUYER_PRIVATE_KEY'))
                if authority.pubkey() != buyer:
                    raise ValueError('BUYER_PRIVATE_KEY does not match the escrow buyer')
            elif os.getenv('SELLER_PRIVATE_KEY'):
                authority = load_keypair('SELLER_PRIVATE_KEY', os.getenv('SELLER_PRIVATE_KEY'))
            elif os.getenv('BUYER_PRIVATE_KEY'):
                authority = load_keypair('BUYER_PRIVATE_KEY', os.getenv('BUYER_PRIVATE_KEY'))
            else:
                raise ValueError('A signing key is required for settlement')
        expected_authority = seller if action == 'release' else buyer
        if authority.pubkey() != expected_authority:
            role = 'seller' if action == 'release' else 'buyer'
            raise ValueError(f'Signing key {authority.pubkey()} does not match escrow {role} {expected_authority}')
        facilitator_value = os.getenv('FACILITATOR_PUBLIC_KEY')
        facilitator = Pubkey.from_string(facilitator_value) if facilitator_value else load_keypair('FACILITATOR_PRIVATE_KEY', os.getenv('FACILITATOR_PRIVATE_KEY')).pubkey()
        if authority.pubkey() == facilitator:
            raise ValueError('The facilitator cannot be the escrow authority')
        recipient = seller if action == 'release' else buyer
        recipient_token = await ensure_token_account(client, authority, mint, recipient)
        vault, _ = Pubkey.find_program_address([b'vault', bytes(escrow_address)], program_id)
        if action == 'release':
            settlement_instruction = instruction(program_id, RELEASE_DISCRIMINATOR, [account_meta(buyer, signer=False, writable=True), account_meta(seller, signer=True, writable=False), account_meta(mint, signer=False, writable=False), account_meta(escrow_address, signer=False, writable=True), account_meta(vault, signer=False, writable=True), account_meta(recipient_token, signer=False, writable=True), account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False)])
        else:
            settlement_instruction = instruction(program_id, REFUND_DISCRIMINATOR, [account_meta(buyer, signer=True, writable=True), account_meta(mint, signer=False, writable=False), account_meta(escrow_address, signer=False, writable=True), account_meta(vault, signer=False, writable=True), account_meta(recipient_token, signer=False, writable=True), account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False)])
        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
        transaction = partially_signed_transaction([settlement_instruction], facilitator, authority, blockhash)
    status, result = facilitator_request(facilitator_url, 'PUT', {'escrowAddress': str(escrow_address), 'action': action, 'transaction': transaction_base64(transaction)})
    if status < 200 or status >= 300 or result.get('success') is not True:
        raise RuntimeError(f'Settlement failed: {result}')
    return result

def run(coroutine: Any) -> None:
    try:
        asyncio.run(coroutine)
    except Exception as error:
        print(str(error), file=__import__('sys').stderr)
        raise SystemExit(1) from error

def anchor_discriminator(namespace: str, name: str) -> bytes:
    return hashlib.sha256(f'{namespace}:{name}'.encode()).digest()[:8]

def format_usdc(base_units: int) -> str:
    whole, fraction = divmod(base_units, 1000000)
    return f'{whole}.{fraction:06d} USDC ({base_units:,} base units)'

def usdc_to_base_units(value: str) -> int:
    whole, separator, fraction = value.partition('.')
    if not whole.isdigit() or (separator and (not fraction.isdigit())) or len(fraction) > 6:
        raise ValueError('Deposit must be positive USDC with at most 6 decimals')
    amount = int(whole) * 1000000 + int((fraction or '').ljust(6, '0'))
    if amount <= 0:
        raise ValueError('Deposit must be positive USDC')
    return amount

def derive_credit_address(program_id: Pubkey, buyer: Pubkey, seller: Pubkey, mint: Pubkey) -> Pubkey:
    credit, _ = Pubkey.find_program_address([b'credit', bytes(buyer), bytes(seller), bytes(mint)], program_id)
    return credit

async def read_credit(rpc_url: str, program_id: Pubkey, buyer: Pubkey, seller: Pubkey, mint: Pubkey) -> tuple[Pubkey, int, int]:
    credit = derive_credit_address(program_id, buyer, seller, mint)
    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        account = cast(Any, (await client.get_account_info(credit, commitment=COMMITMENT)).value)
    if account is None:
        return (credit, 0, 0)
    data = bytes(account.data)
    if str(account.owner) != str(program_id) or len(data) < 121 or data[:8] != anchor_discriminator('account', 'Credit'):
        raise ValueError('Credit PDA contains an invalid GHOSTRAIL account')
    if Pubkey.from_bytes(data[8:40]) != buyer or Pubkey.from_bytes(data[40:72]) != seller or Pubkey.from_bytes(data[72:104]) != mint:
        raise ValueError('Credit account does not match this buyer, seller, and mint')
    return (credit, int.from_bytes(data[104:112], 'little'), int.from_bytes(data[112:120], 'little'))

async def withdraw_all_credit(rpc_url: str, program_id: Pubkey, buyer: Keypair, seller: Pubkey, mint: Pubkey) -> str | None:
    credit, balance, _ = await read_credit(rpc_url, program_id, buyer.pubkey(), seller, mint)
    if balance == 0:
        print('No prepaid USDC remains for this buyer and seller.')
        return None
    vault, _ = Pubkey.find_program_address([b'vault', bytes(credit)], program_id)
    data = anchor_discriminator('global', 'withdraw_credit') + balance.to_bytes(8, 'little')
    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        buyer_token = await ensure_token_account(client, buyer, mint, buyer.pubkey())
        withdraw_ix = instruction(program_id, data, [account_meta(buyer.pubkey(), signer=True, writable=True), account_meta(mint, signer=False, writable=False), account_meta(credit, signer=False, writable=True), account_meta(vault, signer=False, writable=True), account_meta(buyer_token, signer=False, writable=True), account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False)])
        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
        tx = signed_transaction([withdraw_ix], buyer, blockhash)
        signature = await send_transaction(client, tx)
    return signature

async def create_and_sign_credit_deposit(rpc_url: str, program_id: Pubkey, buyer: Keypair, seller: Pubkey, mint: Pubkey, amount: int) -> tuple[str, Pubkey]:
    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        buyer_balance = cast(Any, (await client.get_balance(buyer.pubkey(), commitment=COMMITMENT)).value)
        if buyer_balance < int(0.01 * LAMPORTS_PER_SOL):
            raise ValueError('Buyer wallet needs at least 0.01 devnet SOL for fees and rent')
        buyer_token = await ensure_token_account(client, buyer, mint, buyer.pubkey())
        token_balance = cast(Any, (await client.get_token_account_balance(buyer_token, commitment=COMMITMENT)).value)
        if int(token_balance.amount) < amount:
            raise ValueError(f'Buyer token account has insufficient funds ({token_balance.amount} < required {amount})')
        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
    credit = derive_credit_address(program_id, buyer.pubkey(), seller, mint)
    vault, _ = Pubkey.find_program_address([b'vault', bytes(credit)], program_id)
    buyer_token = get_associated_token_address(buyer.pubkey(), mint)
    seller_token = get_associated_token_address(seller, mint)
    data = anchor_discriminator('global', 'deposit_credit') + amount.to_bytes(8, 'little')
    deposit_ix = instruction(program_id, data, [account_meta(buyer.pubkey(), signer=True, writable=True), account_meta(seller, signer=False, writable=False), account_meta(mint, signer=False, writable=False), account_meta(credit, signer=False, writable=True), account_meta(buyer_token, signer=False, writable=True), account_meta(vault, signer=False, writable=True), account_meta(seller_token, signer=False, writable=True), account_meta(SYSTEM_PROGRAM_ID, signer=False, writable=False), account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False), account_meta(ASSOCIATED_TOKEN_PROGRAM_ID, signer=False, writable=False)])
    tx = signed_transaction([deposit_ix], buyer, blockhash)
    return (transaction_base64(tx), credit)

def submit_credit_deposit(facilitator_url: str, transaction_base64_value: str) -> dict[str, Any]:
    status, payload = json_request(f"{facilitator_url.rstrip('/')}/api", 'PUT', {'action': 'deposit', 'transaction': transaction_base64_value})
    if status < 200 or status >= 300 or payload.get('success') is not True:
        raise RuntimeError(f'Prepaid USDC deposit failed: {payload}')
    return payload

DEFAULT_SERVICE_URL = 'http://127.0.0.1:8080/chat'

DEFAULT_PROMPT = 'Explain Solana escrow in one sentence.'

DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

DEFAULT_SOLANA_RPC_URL = 'https://api.devnet.solana.com'

if sys.platform == 'win32':
    try:
        cast(Any, sys.stdout).reconfigure(encoding='utf-8', errors='replace')
        cast(Any, sys.stderr).reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, OSError):
        pass

def probe_service_payment_info(service_url: str, prompt: str) -> dict[str, Any]:
    req = Request(service_url, data=json.dumps({'prompt': prompt}).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=15) as response:
            body = json.loads(response.read().decode('utf-8'))
            print('[Buyer] Service answered for free! No payment was required.')
            print('Response:', body.get('response', body))
            sys.exit(0)
    except HTTPError as error:
        if error.code != 402:
            raise RuntimeError(f"Service returned unexpected HTTP {error.code}: {error.read().decode('utf-8')}") from error
        try:
            payload = json.loads(error.read().decode('utf-8'))
        except (ValueError, json.JSONDecodeError) as decode_err:
            raise RuntimeError('Service returned HTTP 402 with invalid JSON') from decode_err
        if payload.get('x402Version') != 1 or not isinstance(payload.get('accepts'), list):
            raise RuntimeError(f'HTTP 402 response did not provide x402 v1 requirements: {payload}')
        requirement = next((item for item in payload['accepts'] if isinstance(item, dict) and item.get('scheme') == 'escrow' and (item.get('network') == 'solana-devnet')), None)
        if not requirement or not requirement.get('payTo') or (not requirement.get('maxAmountRequired')) or (not requirement.get('asset')) or (not isinstance(requirement.get('extra'), dict)) or (not requirement['extra'].get('escrowProgramId')) or (requirement['extra'].get('creditModel') != 'prepaid'):
            raise RuntimeError(f'HTTP 402 response did not provide valid escrow requirements: {payload}')
        return requirement

async def create_and_sign_credit_charge(rpc_url: str, program_id: Pubkey, buyer: Keypair, seller: Pubkey, mint: Pubkey, amount: int, nonce: int) -> tuple[str, Pubkey]:
    credit = derive_credit_address(program_id, buyer.pubkey(), seller, mint)
    vault, _ = Pubkey.find_program_address([b'vault', bytes(credit)], program_id)
    seller_token = get_associated_token_address(seller, mint)
    data = anchor_discriminator('global', 'charge_credit') + amount.to_bytes(8, 'little') + nonce.to_bytes(8, 'little')
    charge_ix = instruction(program_id, data, [account_meta(buyer.pubkey(), signer=True, writable=True), account_meta(seller, signer=False, writable=False), account_meta(mint, signer=False, writable=False), account_meta(credit, signer=False, writable=True), account_meta(vault, signer=False, writable=True), account_meta(seller_token, signer=False, writable=True), account_meta(TOKEN_PROGRAM_ID, signer=False, writable=False)])
    async with AsyncClient(rpc_url, commitment=COMMITMENT) as client:
        blockhash = cast(Any, (await client.get_latest_blockhash(commitment=COMMITMENT)).value).blockhash
    tx = signed_transaction([charge_ix], buyer, blockhash)
    return (transaction_base64(tx), credit)

def encode_x402_payment(tx_base64: str) -> str:
    payment = {'x402Version': 1, 'scheme': 'escrow', 'network': 'solana-devnet', 'payload': {'transaction': tx_base64}}
    return base64.b64encode(json.dumps(payment).encode('utf-8')).decode('ascii')

def call_service_with_payment(service_url: str, prompt: str, tx_base64: str) -> tuple[dict[str, Any], str | None]:
    req = Request(service_url, data=json.dumps({'prompt': prompt}).encode('utf-8'), headers={'Content-Type': 'application/json', 'X-PAYMENT': encode_x402_payment(tx_base64)})
    try:
        with urlopen(req, timeout=90) as response:
            body = cast(dict[str, Any], json.loads(response.read().decode('utf-8')))
            return (body, response.headers.get('X-PAYMENT-RESPONSE'))
    except HTTPError as error:
        detail = error.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'Paid service returned HTTP {error.code}: {detail}') from error

def decode_payment_response(header: str | None) -> dict[str, Any] | None:
    if not header:
        return None
    try:
        decoded = base64.b64decode(header, validate=True)
        payload = json.loads(decoded.decode('utf-8'))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError('Service returned an invalid X-PAYMENT-RESPONSE header') from error
    if not isinstance(payload, dict):
        raise RuntimeError('Service returned an invalid X-PAYMENT-RESPONSE payload')
    return payload

async def _call_service_main(service_url_arg: str | None=None, prompt_arg: str | None=None, buyer_wallet: Keypair | None=None, use_cli_args: bool=True, service_id_arg: str | None=None) -> Any:
    load_dotenv()
    cli_args = sys.argv[1:] if use_cli_args and service_url_arg is None and (prompt_arg is None) else []
    service_url = service_url_arg or os.getenv('SERVICE_URL') or (cli_args[0] if cli_args and cli_args[0].startswith('http') else DEFAULT_SERVICE_URL)
    service_id = service_id_arg or os.getenv('SERVICE_ID')
    prompt = prompt_arg or os.getenv('PROMPT') or (cli_args[1] if len(cli_args) > 1 else cli_args[0] if cli_args and (not cli_args[0].startswith('http')) else DEFAULT_PROMPT)
    rpc_url = os.getenv('SOLANA_RPC_URL', DEFAULT_SOLANA_RPC_URL)
    buyer = buyer_wallet or load_keypair('BUYER_PRIVATE_KEY', os.getenv('BUYER_PRIVATE_KEY'))
    payment_info = probe_service_payment_info(service_url, prompt)
    service_id = service_id or payment_info.get('extra', {}).get('serviceId')
    seller = Pubkey.from_string(str(payment_info['payTo']))
    if buyer.pubkey() == seller:
        raise ValueError('BUYER_PRIVATE_KEY resolves to the service seller wallet. Configure a separate buyer wallet key.')
    mint = Pubkey.from_string(str(payment_info['asset']))
    program_id = Pubkey.from_string(str(payment_info['extra']['escrowProgramId']))
    amount = int(str(payment_info['maxAmountRequired']))
    credit, balance, nonce = await read_credit(rpc_url, program_id, buyer.pubkey(), seller, mint)
    if balance < amount:
        raise ValueError(f'Insufficient prepaid credit ({balance} available, {amount} required). Deposit separately with: python ghostrail_sdk/python/examples/deposit_credit.py')
    tx_base64, credit = await create_and_sign_credit_charge(rpc_url, program_id, buyer, seller, mint, amount, nonce)
    result, response_header = call_service_with_payment(service_url, prompt, tx_base64)
    payment_response = decode_payment_response(response_header)
    payment_meta = result.get('payment')
    charge_meta = result.get('charge')
    if not isinstance(payment_meta, dict) or payment_meta.get('accepted') is not True or (not isinstance(charge_meta, dict)) or (charge_meta.get('success') is not True) or (not payment_response) or (payment_response.get('success') is not True) or (payment_response.get('network') != 'solana-devnet') or (payment_response.get('transaction') != charge_meta.get('signature')):
        raise RuntimeError('Service response did not include a matching confirmed X-PAYMENT-RESPONSE receipt')
    return {
        'response': result.get('response', result),
        'transaction': payment_response['transaction'],
        'endpoint': service_url,
        'service_id': service_id,
    }

DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

async def _check_credit_main(seller_address: str | None=None, buyer_address: str | None=None) -> str:
    seller_arg = seller_address or (sys.argv[1] if len(sys.argv) == 2 else None)
    if not seller_arg:
        raise SystemExit('Set BUYER_ADDRESS and SELLER_ADDRESS in examples/check_credit.py')
    load_dotenv()
    buyer_pubkey = Pubkey.from_string(buyer_address) if buyer_address else load_keypair('BUYER_PRIVATE_KEY', os.getenv('BUYER_PRIVATE_KEY')).pubkey()
    seller = Pubkey.from_string(seller_arg)
    rpc_url = os.getenv('SOLANA_RPC_URL', DEFAULT_SOLANA_RPC_URL)
    program_id = Pubkey.from_string(required('ESCROW_PROGRAM_ID', os.getenv('ESCROW_PROGRAM_ID')))
    mint = Pubkey.from_string(os.getenv('USDC_MINT', DEVNET_USDC_MINT))
    credit, balance, _ = await read_credit(rpc_url, program_id, buyer_pubkey, seller, mint)
    return format_usdc(balance).split()[0]

DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

FACILITATOR_URL = 'http://127.0.0.1:3000'

MIN_CREDIT_DEPOSIT = 1000000

MAX_CREDIT_BALANCE = 100000000

def usage() -> str:
    return 'Set SELLER_ADDRESS and AMOUNT_USDC in examples/deposit_credit.py'

async def _deposit_credit_main(seller_public_key: str | None=None, amount_usdc: str | None=None, buyer_wallet: Keypair | None=None) -> dict[str, object]:
    cli_args = sys.argv[1:] if seller_public_key is None else []
    seller_arg = seller_public_key or (cli_args[0] if cli_args else None)
    amount_arg = amount_usdc or (cli_args[1] if len(cli_args) == 2 else None)
    if not seller_arg or len(cli_args) not in (0, 1, 2):
        raise SystemExit(usage())
    load_dotenv()
    buyer = buyer_wallet or load_keypair('BUYER_PRIVATE_KEY', os.getenv('BUYER_PRIVATE_KEY'))
    seller = Pubkey.from_string(seller_arg)
    if buyer.pubkey() == seller:
        raise ValueError('Buyer and seller must be different wallets')
    amount_text = amount_arg or os.getenv('DEPOSIT_USDC', '1')
    amount = usdc_to_base_units(amount_text)
    if amount < MIN_CREDIT_DEPOSIT or amount > MAX_CREDIT_BALANCE:
        raise ValueError('Deposit amount must be between 1 and 100 USDC')
    rpc_url = os.getenv('SOLANA_RPC_URL', DEFAULT_SOLANA_RPC_URL)
    program_id = Pubkey.from_string(required('ESCROW_PROGRAM_ID', os.getenv('ESCROW_PROGRAM_ID')))
    mint = Pubkey.from_string(os.getenv('USDC_MINT', DEVNET_USDC_MINT))
    credit, balance, _ = await read_credit(rpc_url, program_id, buyer.pubkey(), seller, mint)
    if balance + amount > MAX_CREDIT_BALANCE:
        raise ValueError(f'Deposit would exceed the 100 USDC credit cap ({balance} already available)')
    print(f'Buyer   : {buyer.pubkey()}')
    print(f'Seller  : {seller}')
    print(f'Credit account: {credit}')
    print(f'Deposit : {format_usdc(amount)}')
    tx_base64, _ = await create_and_sign_credit_deposit(rpc_url, program_id, buyer, seller, mint, amount)
    facilitator_url = os.getenv('FACILITATOR_URL', FACILITATOR_URL)
    result = submit_credit_deposit(facilitator_url, tx_base64)
    print(f"Deposit confirmed: {result['signature']}")
    print(f"Available credit : {format_usdc(int(result['balance']))}")
    return result

DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

async def _withdraw_credit_main(seller_public_key: str | None=None, buyer_wallet: Keypair | None=None) -> str | None:
    seller_arg = seller_public_key or (sys.argv[1] if len(sys.argv) == 2 else None)
    if not seller_arg:
        raise SystemExit('Set SELLER_ADDRESS in examples/withdraw_credit.py')
    load_dotenv()
    buyer = buyer_wallet or load_keypair('BUYER_PRIVATE_KEY', os.getenv('BUYER_PRIVATE_KEY'))
    rpc_url = os.getenv('SOLANA_RPC_URL', DEFAULT_SOLANA_RPC_URL)
    program_id = Pubkey.from_string(required('ESCROW_PROGRAM_ID', os.getenv('ESCROW_PROGRAM_ID')))
    mint = Pubkey.from_string(os.getenv('USDC_MINT', DEVNET_USDC_MINT))
    seller = Pubkey.from_string(seller_arg)
    credit, balance, _ = await read_credit(rpc_url, program_id, buyer.pubkey(), seller, mint)
    if balance == 0:
        print('No prepaid USDC remains for this buyer and seller.')
        return None
    print(f'Buyer          : {buyer.pubkey()}')
    print(f'Seller         : {seller}')
    print(f'Credit account : {credit}')
    print(f'Withdrawal     : {format_usdc(balance)}')
    signature = await withdraw_all_credit(rpc_url, program_id, buyer, seller, mint)
    if signature:
        print(f'Withdrawal confirmed: {signature}')
        print('Available credit   : 0.000000 USDC (0 base units)')
    return signature

class Buyer:

    @staticmethod
    def _run(coroutine):
        load_dotenv()
        return asyncio.run(coroutine)

    @staticmethod
    def _signer(private_key):
        load_dotenv()
        return load_keypair("BUYER_PRIVATE_KEY", private_key or os.getenv("BUYER_PRIVATE_KEY"))

    def call_service(self, buyer_private_key, service_url=None, prompt=None, service_id=None):
        signer = self._signer(buyer_private_key)
        return self._run(_call_service_main(service_url, prompt, signer, False, service_id))

    def check_credit(self, buyer_address, seller_address):
        return self._run(_check_credit_main(seller_address, str(buyer_address)))

    def deposit_credit(self, buyer_private_key, seller_address, amount_usdc="1"):
        signer = self._signer(buyer_private_key)
        return self._run(_deposit_credit_main(seller_address, amount_usdc, signer))

    def withdraw_credit(self, buyer_private_key, seller_address):
        signer = self._signer(buyer_private_key)
        return self._run(_withdraw_credit_main(seller_address, signer))


__all__ = ["Buyer"]
