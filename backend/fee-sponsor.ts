import "server-only";

import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

// ── Config ──────────────────────────────────────────────────────────

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");

/**
 * The fee-payer wallet. This wallet pays SOL transaction fees so buyers
 * don't need SOL. It must NEVER be used as an authority on escrow accounts.
 */
const feePayerKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.FEE_PAYER_PRIVATE_KEY!)
);

/**
 * Sign and submit a transaction with the fee-payer covering SOL fees.
 *
 * The buyer constructs and signs the transaction, then this function
 * adds the fee-payer as the actual fee payer and co-signs.
 *
 * @param serializedTransaction - Base64-encoded partially-signed transaction
 * @returns The transaction signature
 */
export async function sponsorAndSubmit(
  serializedTransaction: string
): Promise<string> {
  const buffer = Buffer.from(serializedTransaction, "base64");
  const tx = Transaction.from(buffer);

  // Set fee payer and get a fresh blockhash
  tx.feePayer = feePayerKeypair.publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  // Partially sign with the fee-payer (buyer's signature is already present)
  tx.partialSign(feePayerKeypair);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(signature, "confirmed");

  return signature;
}

/**
 * Get the fee-payer's public key.
 * Used by the API route to tell clients who the fee payer is.
 */
export function getFeePayerPublicKey(): string {
  return feePayerKeypair.publicKey.toBase58();
}
