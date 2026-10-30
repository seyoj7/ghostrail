# Example: call a paid service using GHOSTRAIL prepaid credit.

import os
from ghostrail_sdk.python.buyer import Buyer

BUYER_PRIVATE_KEY = os.getenv("BUYER_PRIVATE_KEY")
API_ENDPOINT = "http://127.0.0.1:8080/api"
PROMPT = "Explain Solana escrow in one sentence."

result = Buyer().call_service(BUYER_PRIVATE_KEY, API_ENDPOINT, PROMPT)

print(result['response'])
print(result['transaction'])
print(f"API Endpoint: {result['endpoint']}")
print(result['service_id'])
