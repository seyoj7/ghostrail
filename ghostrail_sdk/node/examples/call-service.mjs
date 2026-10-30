import { Ghostrail } from "../buyer.js";

const API_ENDPOINT = "http://127.0.0.1:8080/chat";
const PROMPT = "Explain Solana escrow in one sentence.";

const sdk = new Ghostrail();
const result = await sdk.callService(
  process.env.BUYER_PRIVATE_KEY,
  API_ENDPOINT,
  PROMPT,
);

console.log(result.response);
console.log(result.transaction);
console.log(`API Endpoint: ${result.endpoint}`);
console.log(result.service_id);
