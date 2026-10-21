import "server-only";

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../escrow/idl/escrow.json";
import { updatePaymentByEscrow } from "./db";
import { fetchEscrow } from "./escrow";
import { EscrowState } from "../types/escrow";

/** Minimal wallet adapter for AnchorProvider (ESM-compatible). */
class NodeWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() { return this.payer.publicKey; }
  async signTransaction(tx: Transaction) { tx.partialSign(this.payer); return tx; }
  async signAllTransactions(txs: Transaction[]) { txs.forEach(t => t.partialSign(this.payer)); return txs; }
}

// ── Config ──────────────────────────────────────────────────────────

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const facilitatorKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.FACILITATOR_PRIVATE_KEY!)
);

const provider = new AnchorProvider(
  connection,
  new NodeWallet(facilitatorKeypair) as any,
  { commitment: "confirmed" }
);
const program = new Program(idl as any, provider);

/**
 * Release escrowed funds to the seller.
 *
 * Called after the seller confirms delivery. The facilitator submits
 * the release transaction on behalf of the seller.
 */
export async function releaseEscrow(
  escrowAddress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const escrow = await fetchEscrow(escrowAddress);
    if (!escrow) {
      return { success: false, error: "Escrow account not found" };
    }
    if (escrow.state !== EscrowState.Locked) {
      return { success: false, error: `Escrow is ${escrow.state}, not Locked` };
    }

    const escrowPubkey = new PublicKey(escrowAddress);
    const mintPubkey = new PublicKey(escrow.mint);
    const buyerPubkey = new PublicKey(escrow.buyer);
    const sellerPubkey = new PublicKey(escrow.seller);

    // Derive vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPubkey.toBuffer()],
      new PublicKey(process.env.ESCROW_PROGRAM_ID!)
    );

    // Find the seller's associated token account
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const sellerToken = await getAssociatedTokenAddress(mintPubkey, sellerPubkey);

    const tx = await (program.methods as any)
      .release()
      .accounts({
        buyer: buyerPubkey,
        seller: sellerPubkey,
        mint: mintPubkey,
        escrow: escrowPubkey,
        vault: vaultPda,
        sellerToken,
      })
      .transaction();

    tx.feePayer = facilitatorKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    await sendAndConfirmTransaction(connection, tx, [facilitatorKeypair]);

    // Update the database record
    await updatePaymentByEscrow(escrowAddress, {
      escrowState: EscrowState.Released,
      settledAt: new Date().toISOString(),
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Refund escrowed funds to the buyer.
 *
 * Called when delivery fails or times out.
 */
export async function refundEscrow(
  escrowAddress: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const escrow = await fetchEscrow(escrowAddress);
    if (!escrow) {
      return { success: false, error: "Escrow account not found" };
    }
    if (escrow.state !== EscrowState.Locked) {
      return { success: false, error: `Escrow is ${escrow.state}, not Locked` };
    }

    const escrowPubkey = new PublicKey(escrowAddress);
    const mintPubkey = new PublicKey(escrow.mint);
    const buyerPubkey = new PublicKey(escrow.buyer);

    // Derive vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPubkey.toBuffer()],
      new PublicKey(process.env.ESCROW_PROGRAM_ID!)
    );

    // Find the buyer's associated token account
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const buyerToken = await getAssociatedTokenAddress(mintPubkey, buyerPubkey);

    const tx = await (program.methods as any)
      .refund()
      .accounts({
        buyer: buyerPubkey,
        mint: mintPubkey,
        escrow: escrowPubkey,
        vault: vaultPda,
        buyerToken,
      })
      .transaction();

    tx.feePayer = facilitatorKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    await sendAndConfirmTransaction(connection, tx, [facilitatorKeypair]);

    // Update the database record
    await updatePaymentByEscrow(escrowAddress, {
      escrowState: EscrowState.Refunded,
      settledAt: new Date().toISOString(),
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
