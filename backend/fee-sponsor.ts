import "server-only";

import { Connection, Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const feePayerKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.FEE_PAYER_PRIVATE_KEY!),
);

/** Add the fee payer and blockhash before the buyer signs. */
export async function prepareForSponsorship(
  serializedTransaction: string,
): Promise<string> {
  const tx = Transaction.from(Buffer.from(serializedTransaction, "base64"));
  tx.feePayer = feePayerKeypair.publicKey;
  tx.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  // Both fields are part of the signed message. Discard stale signatures so
  // the buyer can sign the sponsored message after it is prepared.
  tx.signatures = tx.signatures.map(({ publicKey }) => ({
    publicKey,
    signature: null,
  }));
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
}

/** Submit a prepared transaction without changing its signed message. */
export async function sponsorAndSubmit(
  serializedTransaction: string,
): Promise<string> {
  const tx = Transaction.from(Buffer.from(serializedTransaction, "base64"));
  if (!tx.feePayer?.equals(feePayerKeypair.publicKey) || !tx.recentBlockhash) {
    throw new Error(
      "Transaction must be prepared with the configured fee payer before signing",
    );
  }
  if (!tx.verifySignatures(false)) {
    throw new Error("Transaction contains an invalid signature");
  }

  tx.partialSign(feePayerKeypair);
  if (!tx.verifySignatures(true)) {
    throw new Error("Transaction is not fully signed");
  }

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction(
    signature,
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error("Sponsored transaction failed on-chain");
  }
  return signature;
}

export function getFeePayerPublicKey(): string {
  return feePayerKeypair.publicKey.toBase58();
}
