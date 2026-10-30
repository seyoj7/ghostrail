import { Seller } from "../seller.js";

// Edit these values for your service.
const SERVICE_NAME = "My Service";
const API_ENDPOINT = "http://127.0.0.1:8080/api";
const SELLER_SOLANA_WALLET = "<Seller_Address>";
const PRICE_USDC = "0.01";

const service = await new Seller().registerService({
  serviceName: SERVICE_NAME,
  apiEndpoint: API_ENDPOINT,
  sellerWallet: SELLER_SOLANA_WALLET,
  priceUsdc: PRICE_USDC,
});

console.log("Service registered");
console.log(`Name: ${service.name}`);
console.log(`Service ID: ${service.id}`);
console.log(`API Endpoint: ${service.endpointUrl}`);
console.log(`Seller wallet: ${service.sellerWallet}`);
console.log(`Price: ${service.priceUsdc} devnet USDC`);
console.log(`Delete token (keep private): ${service.deleteToken}`);
