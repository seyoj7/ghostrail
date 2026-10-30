# Register a seller's service API with the GHOSTRAIL facilitator.

from ghostrail_sdk.python.seller import Seller

# Edit these values for your service. 
# The API Endpoint must be HTTPS outside localhost.

SERVICE_NAME = "My Service"
API_ENDPOINT = "http://127.0.0.1:8080/api"
SELLER_SOLANA_WALLET = "<Seller_Address>"
PRICE_USDC = "0.01"

service = Seller().register_service(
    service_name=SERVICE_NAME,
    api_endpoint=API_ENDPOINT,
    seller_wallet=SELLER_SOLANA_WALLET,
    price_usdc=PRICE_USDC,
)

print("Service registered")
print(f"Name: {service['name']}")
print(f"Service ID: {service['id']}")
print(f"API Endpoint: {service['endpointUrl']}")
print(f"Seller wallet: {service['sellerWallet']}")
print(f"Price: {service['priceUsdc']} devnet USDC")
print(f"Delete token (keep private): {service['deleteToken']}")
