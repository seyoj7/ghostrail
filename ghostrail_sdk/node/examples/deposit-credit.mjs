import { Ghostrail } from "../buyer.js";

const SELLER_ADDRESS = "<Seller_Address>";
const AMOUNT_USDC = "1"; // Default set to 1

await new Ghostrail().depositCredit(
  process.env.BUYER_PRIVATE_KEY,
  SELLER_ADDRESS,
  AMOUNT_USDC,
);
