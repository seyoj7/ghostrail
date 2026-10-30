import { Ghostrail } from "../buyer.js";

const SELLER_ADDRESS = "<Seller_Address>";

await new Ghostrail().withdrawCredit(
  process.env.BUYER_PRIVATE_KEY,
  SELLER_ADDRESS,
);
