/**
 * Reads the private keys from .env and prints the matching public addresses.
 * Run:  node scripts/show-addresses.mjs
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "fs";

const env = readFileSync(".env", "utf-8");
const vars = Object.fromEntries(
  env.split(/\r?\n/).filter(l => l.includes("=")).map(l => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  })
);

for (const name of ["FACILITATOR_PRIVATE_KEY", "FEE_PAYER_PRIVATE_KEY"]) {
  const val = vars[name];
  if (!val || val === "<base58>") {
    console.log(`${name}: (not set)`);
    continue;
  }
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(val));
    console.log(`${name}`);
    console.log(`  Address: ${kp.publicKey.toBase58()}\n`);
  } catch {
    console.log(`${name}: (invalid key)`);
  }
}

console.log("Paste these addresses into https://faucet.solana.com");
