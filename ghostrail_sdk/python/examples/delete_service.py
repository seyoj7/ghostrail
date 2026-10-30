# Delete a registered service using its private delete token.

from ghostrail_sdk.python.seller import Seller

SERVICE_ID = "<Service_Id>"
DELETE_TOKEN = "<Delete_Token>"

Seller().delete_service(SERVICE_ID, DELETE_TOKEN)
print(f"Deleted service {SERVICE_ID}.")
