# Example: withdraw unused prepaid USDC credit for a seller.

import os
from ghostrail_sdk.python.buyer import Buyer

BUYER_PRIVATE_KEY = os.getenv("BUYER_PRIVATE_KEY")
SELLER_ADDRESS = "<Seller_Address>"

Buyer().withdraw_credit(BUYER_PRIVATE_KEY, SELLER_ADDRESS)
