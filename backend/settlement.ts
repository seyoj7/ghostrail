import "server-only";

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { updatePaymentByEscrow } from "./db";
import { fetchEscrow } from "./escrow";
import { EscrowState } from "../types/escrow";

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const facilitatorKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.FACILITATOR_PRIVATE_KEY!),
);
const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID!);
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RELEASE_DISCRIMINATOR = Buffer.from([
  253, 249, 15, 206, 28, 127, 193, 241,
]);
const REFUND_DISCRIMINATOR = Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]);

type SettlementResult = {
  success: boolean;
  signature?: string;
  error?: string;
};

/** Submit a seller-signed release transaction. */
export async function releaseEscrow(
  escrowAddress: string,
  serializedTransaction: string,
): Promise<SettlementResult> {
  return settleEscrow(escrowAddress, serializedTransaction, "release");
}

/** Submit a buyer-signed refund transaction. */
export async function refundEscrow(
  escrowAddress: string,
  serializedTransaction: string,
): Promise<SettlementResult> {
  return settleEscrow(escrowAddress, serializedTransaction, "refund");
}

async function settleEscrow(
  escrowAddress: string,
  serializedTransaction: string,
  action: "release" | "refund",
): Promise<SettlementResult> {
  try {
    const escrow = await fetchEscrow(escrowAddress);
    if (!escrow) {
      return { success: false, error: "Escrow account not found" };
    }
    if (escrow.state !== EscrowState.Locked) {
      return { success: false, error: `Escrow is ${escrow.state}, not Locked` };
    }

    const escrowPubkey = new PublicKey(escrowAddress);
    const tx = Transaction.from(Buffer.from(serializedTransaction, "base64"));
    const instruction =
      tx.instructions.length === 1 ? tx.instructions[0] : undefined;
    if (
      !instruction ||
      !tx.feePayer?.equals(facilitatorKeypair.publicKey) ||
      !tx.recentBlockhash
    ) {
      return {
        success: false,
        error: "Settlement transaction must use the facilitator as fee payer",
      };
    }
    if (
      !instruction.programId.equals(ESCROW_PROGRAM_ID) ||
      !tx.verifySignatures(false)
    ) {
      return {
        success: false,
        error: "Settlement transaction is invalid or unsigned",
      };
    }
    if (
      instruction.keys.some((key) =>
        key.pubkey.equals(facilitatorKeypair.publicKey),
      )
    ) {
      return {
        success: false,
        error: "Facilitator cannot be an escrow authority",
      };
    }

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPubkey.toBuffer()],
      ESCROW_PROGRAM_ID,
    );
    const mint = new PublicKey(escrow.mint);
    const buyer = new PublicKey(escrow.buyer);
    const seller = new PublicKey(escrow.seller);
    const expectedSigner = action === "release" ? seller : buyer;
    const expectedDiscriminator =
      action === "release" ? RELEASE_DISCRIMINATOR : REFUND_DISCRIMINATOR;

    if (!instruction.data.equals(expectedDiscriminator)) {
      return {
        success: false,
        error: `Transaction is not a ${action} instruction`,
      };
    }
    if (
      !instruction.keys.some(
        (key) => key.pubkey.equals(expectedSigner) && key.isSigner,
      )
    ) {
      return {
        success: false,
        error: "The required buyer or seller signature is missing",
      };
    }
    if (
      !tx.signatures.some(
        (entry) => entry.publicKey.equals(expectedSigner) && entry.signature,
      )
    ) {
      return {
        success: false,
        error: "The required buyer or seller signature is missing",
      };
    }

    if (action === "release") {
      if (
        instruction.keys.length !== 7 ||
        !instruction.keys[0].pubkey.equals(buyer) ||
        !instruction.keys[0].isWritable ||
        !instruction.keys[1].pubkey.equals(seller) ||
        !instruction.keys[1].isSigner ||
        !instruction.keys[2].pubkey.equals(mint) ||
        !instruction.keys[3].pubkey.equals(escrowPubkey) ||
        !instruction.keys[4].pubkey.equals(vaultPda) ||
        !instruction.keys[5].isWritable ||
        !isTokenProgram(instruction.keys[6].pubkey)
      ) {
        return {
          success: false,
          error: "Release accounts do not match escrow state",
        };
      }
    } else if (
      instruction.keys.length !== 6 ||
      !instruction.keys[0].pubkey.equals(buyer) ||
      !instruction.keys[0].isSigner ||
      !instruction.keys[0].isWritable ||
      !instruction.keys[1].pubkey.equals(mint) ||
      !instruction.keys[2].pubkey.equals(escrowPubkey) ||
      !instruction.keys[3].pubkey.equals(vaultPda) ||
      !instruction.keys[4].isWritable ||
      !isTokenProgram(instruction.keys[5].pubkey)
    ) {
      return {
        success: false,
        error: "Refund accounts do not match escrow state",
      };
    }

    tx.partialSign(facilitatorKeypair);
    if (!tx.verifySignatures(true)) {
      return {
        success: false,
        error: "Settlement transaction is not fully signed",
      };
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
      return {
        success: false,
        error: "Settlement transaction failed on-chain",
      };
    }

    await updatePaymentByEscrow(escrowAddress, {
      escrowState:
        action === "release" ? EscrowState.Released : EscrowState.Refunded,
      settledAt: new Date().toISOString(),
    });
    return { success: true, signature };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function isTokenProgram(key: PublicKey): boolean {
  return (
    key.toBase58() === TOKEN_PROGRAM_ID ||
    key.toBase58() === TOKEN_2022_PROGRAM_ID
  );
}
