from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_FACILITATOR_URL = "http://127.0.0.1:3000"


class Seller:

    def __init__(self, facilitator_url: str | None = None) -> None:
        self.facilitator_url = (
            facilitator_url or os.getenv("FACILITATOR_URL") or DEFAULT_FACILITATOR_URL
        ).rstrip("/")

    def register_service(
        self,
        service_name: str,
        api_endpoint: str,
        seller_wallet: str,
        price_usdc: str,
    ) -> dict[str, Any]:

        payload = {
            "name": service_name,
            "endpointUrl": api_endpoint,
            "sellerWallet": seller_wallet,
            "priceUsdc": str(price_usdc),
        }
        request = Request(
            f"{self.facilitator_url}/api/services",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=15) as response:
                result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                details = json.loads(error.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                details = {}
            message = details.get("error", f"HTTP {error.code}")
            raise RuntimeError(f"Service registration failed: {message}") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError(
                f"Could not reach GHOSTRAIL facilitator at {self.facilitator_url}"
            ) from error
        if not isinstance(result, dict) or not result.get("id"):
            raise RuntimeError(f"Facilitator returned an invalid service response: {result}")
        return result

    def delete_service(self, service_id: str, delete_token: str) -> None:

        request = Request(
            f"{self.facilitator_url}/api/services/{service_id}",
            headers={"Authorization": f"Bearer {delete_token}"},
            method="DELETE",
        )
        try:
            with urlopen(request, timeout=15):
                return
        except HTTPError as error:
            try:
                details = json.loads(error.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                details = {}
            message = details.get("error", f"HTTP {error.code}")
            raise RuntimeError(f"Service deletion failed: {message}") from error
        except (URLError, TimeoutError) as error:
            raise RuntimeError(
                f"Could not reach GHOSTRAIL facilitator at {self.facilitator_url}"
            ) from error