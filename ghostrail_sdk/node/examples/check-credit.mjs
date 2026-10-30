import { Ghostrail } from "../buyer.js";

const BUYER_ADDRESS = "<Buyer_Address>";
const SELLER_ADDRESS = "<Seller_Address>";

const credits = await new Ghostrail().checkCredit(
  BUYER_ADDRESS,
  SELLER_ADDRESS,
);
console.log(`Available credit: ${credits} USDC`);
