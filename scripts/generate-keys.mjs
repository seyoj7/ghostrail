/**
 * Generate fresh Solana devnet keypairs for the facilitator and fee payer.
 * Run once:  node scripts/generate-keys.mjs
 *
 * Paste the output into .env (never commit it).
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const facilitator = Keypair.generate();
const feePayer = Keypair.generate();

console.log("──────────────────────────────────────────────");
console.log("  Paste these into .env  (keep them secret!)");
console.log("──────────────────────────────────────────────\n");

console.log(`FACILITATOR_PRIVATE_KEY=${bs58.encode(facilitator.secretKey)}`);
console.log(`FEE_PAYER_PRIVATE_KEY=${bs58.encode(feePayer.secretKey)}`);

console.log("\n── Public keys (for reference / airdrop) ─────\n");

console.log(`Facilitator:  ${facilitator.publicKey.toBase58()}`);
console.log(`Fee Payer:    ${feePayer.publicKey.toBase58()}`);

console.log("\n── Next steps ────────────────────────────────");
console.log("1. Paste the two PRIVATE_KEY lines into .env");
console.log("2. Airdrop devnet SOL to both public keys:");
console.log(`   solana airdrop 2 ${feePayer.publicKey.toBase58()} --url devnet`);
console.log(`   solana airdrop 2 ${facilitator.publicKey.toBase58()} --url devnet`);
console.log("──────────────────────────────────────────────");
