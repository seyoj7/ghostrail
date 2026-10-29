from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.ghostrail_common import load_dotenv

load_dotenv()

# ===========================================================================
# Local demo configuration. Set service values in this file.
# ===========================================================================
NVIDIA_API_KEY = "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"
SELLER_WALLET = "2D8pmhdpZCmWnS23qpWsKecgXts2RAszFjHLDpFXYniD"
SERVICE_PRICE_USDC = "0.01"
USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
ESCROW_PROGRAM_ID = os.getenv("ESCROW_PROGRAM_ID", "")
if not ESCROW_PROGRAM_ID:
    raise RuntimeError("ESCROW_PROGRAM_ID must be set in the repository-root .env or process environment")
FACILITATOR_URL = "http://localhost:3000"
SERVICE_ID = "a1171114-472a-45b0-b4b4-343713f9a0ae"

NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
SERVICE_HOST = "127.0.0.1"
SERVICE_PORT = 8080

MAX_PROMPT_LENGTH = 4_000
MAX_REQUEST_BODY_BYTES = 64 * 1024
REQUEST_TIMEOUT_SECONDS = 30
USDC_DECIMALS = 6
PAYMENT_TIMEOUT_SECONDS = 300
MIN_CREDIT_DEPOSIT = 1_000_000
MAX_CREDIT_BALANCE = 100_000_000
# ===========================================================================


def json_response(
    handler: BaseHTTPRequestHandler,
    status: int,
    body: dict[str, Any],
    headers: Mapping[str, str] | None = None,
) -> None:
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    for name, value in (headers or {}).items():
        handler.send_header(name, value)
    handler.end_headers()
    handler.wfile.write(payload)


def configured_payment_terms() -> dict[str, str]:
    if SERVICE_ID:
        request = Request(f"{FACILITATOR_URL.rstrip('/')}/api/services/{SERVICE_ID}")
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                service = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            raise RuntimeError("Could not load the registered service payment requirements") from error
        requirements = service.get("paymentRequirements") if isinstance(service, dict) else None
        if not isinstance(requirements, dict):
            raise RuntimeError("Registered service returned invalid payment requirements")
        try:
            return {
                "seller": str(requirements["seller"]),
                "amount": str(requirements["amount"]),
                "mint": str(requirements["mint"]),
            }
        except KeyError as error:
            raise RuntimeError("Registered service returned incomplete payment requirements") from error

    price = SERVICE_PRICE_USDC
    whole, separator, fraction = price.partition(".")
    if (
        not whole.isdigit()
        or (separator and not fraction.isdigit())
        or len(fraction) > USDC_DECIMALS
        or int(whole) < 0
        or (int(whole) == 0 and int(fraction or "0") == 0)
    ):
        raise RuntimeError("SERVICE_PRICE_USDC must be a positive USDC amount")
    amount = int(whole) * 10**USDC_DECIMALS + int(
        (fraction or "").ljust(USDC_DECIMALS, "0")
    )
    return {
        "seller": SELLER_WALLET,
        "amount": str(amount),
        "mint": USDC_MINT,
    }


def payment_requirements(resource: str) -> dict[str, Any]:
    terms = configured_payment_terms()
    return {
        "x402Version": 1,
        "accepts": [
            {
                "scheme": "escrow",
                "network": "solana-devnet",
                "maxAmountRequired": terms["amount"],
                "resource": resource,
                "description": "Charge from reusable GHOSTRAIL USDC credit",
                "mimeType": "application/json",
                "payTo": terms["seller"],
                "asset": terms["mint"],
                "extra": {
                    "escrowProgramId": ESCROW_PROGRAM_ID,
                    "creditModel": "prepaid",
                    "minDepositAmount": str(MIN_CREDIT_DEPOSIT),
                    "maxBalanceAmount": str(MAX_CREDIT_BALANCE),
                },
            }
        ],
    }


def verify_payment(payment_header: str, terms: dict[str, str]) -> dict[str, Any]:
    if SERVICE_ID:
        # Auto-resolve seller, amount, and mint from the service registry.
        body: dict[str, Any] = {
            "serviceId": SERVICE_ID,
        }
    else:
        body = {
            "seller": terms["seller"],
            "amount": terms["amount"],
            "mint": terms["mint"],
        }

    request = Request(
        f"{FACILITATOR_URL.rstrip('/')}/api",
        method="POST",
        headers={"Content-Type": "application/json", "X-PAYMENT": payment_header},
        data=json.dumps(body).encode("utf-8"),
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status = response.status
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        status = error.code
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {"error": "Facilitator returned an invalid response"}
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError("Could not reach the GHOSTRAIL facilitator") from error

    if not isinstance(payload, dict):
        raise RuntimeError("Facilitator returned an invalid response")
    if status < 200 or status >= 300 or payload.get("accepted") is not True:
        return payload
    return payload


def charge_prepaid_credit(
    credit_address: str, signature: str, transaction: str
) -> dict[str, Any]:
    """Submit the buyer-authorized call charge after delivery succeeds."""
    request = Request(
        f"{FACILITATOR_URL.rstrip('/')}/api",
        method="PUT",
        headers={"Content-Type": "application/json"},
        data=json.dumps(
            {
                "action": "charge",
                "creditAddress": credit_address,
                "signature": signature,
                "transaction": transaction,
            }
        ).encode("utf-8"),
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Credit charge failed (HTTP {error.code}): {detail}") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError("Could not settle the prepaid credit charge") from error
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise RuntimeError(f"Credit charge was not confirmed: {payload}")
    return payload


def payment_response_header(transaction: str) -> str:
    response = {
        "success": True,
        "transaction": transaction,
        "network": "solana-devnet",
    }
    return base64.b64encode(json.dumps(response).encode("utf-8")).decode("ascii")


class NvidiaServiceHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/health":
            json_response(self, 404, {"error": "Not found"})
            return
        json_response(
            self,
            200,
            {
                "service": "GHOSTRAIL NVIDIA LLM service",
                "configured": bool(NVIDIA_API_KEY),
                "model": NVIDIA_MODEL,
                "paymentRequired": True,
            },
        )

    def do_POST(self) -> None:
        if self.path != "/chat":
            json_response(self, 404, {"error": "Not found"})
            return

        if not NVIDIA_API_KEY:
            json_response(self, 503, {"error": "NVIDIA_API_KEY is not configured"})
            return

        try:
            body = self.read_json()
            prompt = body.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("prompt is required")
            prompt = prompt.strip()
            if len(prompt) > MAX_PROMPT_LENGTH:
                raise ValueError(
                    f"prompt must be {MAX_PROMPT_LENGTH} characters or fewer"
                )
            payment_header = self.headers.get("X-PAYMENT")
            if not payment_header:
                resource = f"http://{SERVICE_HOST}:{SERVICE_PORT}{self.path}"
                json_response(
                    self,
                    402,
                    {
                        "error": "Payment required",
                        **payment_requirements(resource),
                    },
                )
                return
            terms = configured_payment_terms()
            verification = verify_payment(payment_header, terms)
            if (
                verification.get("accepted") is not True
                or verification.get("state") != "Prepaid"
            ):
                json_response(
                    self,
                    402,
                    {
                        "error": "Payment rejected by facilitator",
                        **payment_requirements(
                            f"http://{SERVICE_HOST}:{SERVICE_PORT}{self.path}"
                        ),
                        "verification": verification,
                    },
                )
                return

            # A handler error leaves prepaid credit untouched.
            result = call_nvidia(NVIDIA_API_KEY, prompt)
            result["payment"] = verification

            credit_address = verification.get("creditAddress")
            charge_signature = verification.get("signature")
            charge_transaction = verification.get("transaction")
            if not credit_address or not charge_signature or not charge_transaction:
                raise RuntimeError("Facilitator accepted payment without a charge authorization")
            try:
                charge_meta = charge_prepaid_credit(
                    str(credit_address),
                    str(charge_signature),
                    str(charge_transaction),
                )
            except Exception as error:
                raise RuntimeError(
                    f"Prepaid charge failed after handler success: {error}"
                ) from error
            if charge_meta.get("success") is not True or not charge_meta.get("signature"):
                raise RuntimeError("Prepaid charge was not confirmed by the facilitator")
            result["charge"] = charge_meta

            json_response(
                self,
                200,
                result,
                headers={
                    "X-PAYMENT-RESPONSE": payment_response_header(str(charge_meta["signature"])),
                    "Cache-Control": "private, no-store",
                },
            )
        except ValueError as error:
            json_response(self, 400, {"error": str(error)})
        except RuntimeError as error:
            status = 503 if "not configured" in str(error) else 502
            json_response(self, status, {"error": str(error)})
        except Exception as error:
            json_response(self, 502, {"error": str(error)})

    def read_json(self) -> dict[str, Any]:
        content_length = self.headers.get("Content-Length")
        if not content_length:
            raise ValueError("Content-Length is required")
        try:
            length = int(content_length)
        except (ValueError, json.JSONDecodeError) as error:
            raise ValueError("Request body must be valid JSON") from error
        if length <= 0:
            raise ValueError("Request body must not be empty")
        if length > MAX_REQUEST_BODY_BYTES:
            raise ValueError("Request body is too large")
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError) as error:
            raise ValueError("Request body must be valid JSON") from error
        if not isinstance(body, dict):
            raise ValueError("Request body must be a JSON object")
        return body

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def call_nvidia(api_key: str, prompt: str) -> dict[str, Any]:
    request = Request(
        NVIDIA_API_URL,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        data=json.dumps(
            {
                "model": NVIDIA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": 1024,
                "chat_template_kwargs": {"enable_thinking": False},
            }
        ).encode("utf-8"),
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            detail = error.read().decode("utf-8", errors="replace")
            parsed_detail = json.loads(detail)
            detail = parsed_detail.get("detail", detail)
            if isinstance(detail, dict):
                detail = detail.get("message", detail)
        except (OSError, json.JSONDecodeError):
            detail = ""
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(f"NVIDIA API returned HTTP {error.code}{suffix}") from error
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError("Could not reach the NVIDIA API") from error

    choices = payload.get("choices")
    choice = choices[0] if isinstance(choices, list) and choices else None
    message = choice.get("message") if isinstance(choice, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        content = "".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    if not isinstance(content, str) or not content.strip():
        finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None
        raise RuntimeError(
            f"NVIDIA API response did not contain generated text (finish_reason={finish_reason!r})"
        )

    return {
        "model": payload.get("model", NVIDIA_MODEL),
        "response": content,
        "usage": payload.get("usage"),
    }


def main() -> None:
    server = ThreadingHTTPServer((SERVICE_HOST, SERVICE_PORT), NvidiaServiceHandler)
    print(f"NVIDIA service listening on http://{SERVICE_HOST}:{SERVICE_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
