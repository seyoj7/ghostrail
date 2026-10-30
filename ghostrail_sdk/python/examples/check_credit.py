# Example: check prepaid USDC credit for a buyer/seller pair.

from ghostrail_sdk.python.buyer import Buyer

BUYER_ADDRESS = "<Buyer_Address>"
SELLER_ADDRESS = "<Seller_Address>"

credits = Buyer().check_credit(BUYER_ADDRESS, SELLER_ADDRESS)

print(f"Available credit: {credits} USDC")
