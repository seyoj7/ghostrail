import "server-only";

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../escrow/idl/escrow.json";
import { EscrowState } from "../types/escrow";
import type { EscrowAccount } from "../types/escrow";

/** Minimal wallet adapter for AnchorProvider (ESM-compatible). */
class NodeWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() { return this.payer.publicKey; }
  async signTransaction(tx: Transaction) { tx.partialSign(this.payer); return tx; }
  async signAllTransactions(txs: Transaction[]) { txs.forEach(t => t.partialSign(this.payer)); return txs; }
}

// ── Config ──────────────────────────────────────────────────────────

const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID!);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const facilitatorKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.FACILITATOR_PRIVATE_KEY!)
);

// Create a read-only Anchor provider for fetching account data
const provider = new AnchorProvider(
  connection,
  new NodeWallet(facilitatorKeypair) as any,
  { commitment: "confirmed" }
);
const program = new Program(idl as any, provider);

/**
 * Fetch an escrow account from on-chain and return its deserialized state.
 * Returns null if the account doesn't exist.
 */
export async function fetchEscrow(
  escrowAddress: string
): Promise<EscrowAccount | null> {
  try {
    const pubkey = new PublicKey(escrowAddress);
    const account = await (program.account as any).escrow.fetch(pubkey);

    const stateMap: Record<string, EscrowState> = {
      locked: EscrowState.Locked,
      released: EscrowState.Released,
      refunded: EscrowState.Refunded,
    };

    const stateKey = Object.keys(account.state)[0];

    return {
      buyer: account.buyer.toBase58(),
      seller: account.seller.toBase58(),
      mint: account.mint.toBase58(),
      amount: BigInt(account.amount.toString()),
      timeout: BigInt(account.timeout.toString()),
      escrowId: BigInt(account.escrowId.toString()),
      state: stateMap[stateKey] ?? EscrowState.Locked,
      bump: account.bump,
    };
  } catch {
    return null;
  }
}

/**
 * Derive the escrow PDA address from buyer and escrow ID.
 */
export function deriveEscrowAddress(
  buyer: string,
  escrowId: bigint
): PublicKey {
  const buyerPubkey = new PublicKey(buyer);
  const escrowIdBuffer = Buffer.alloc(8);
  escrowIdBuffer.writeBigUInt64LE(escrowId);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), buyerPubkey.toBuffer(), escrowIdBuffer],
    ESCROW_PROGRAM_ID
  );

  return pda;
}

/**
 * Derive the vault PDA address from the escrow PDA.
 */
export function deriveVaultAddress(escrowAddress: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrowAddress.toBuffer()],
    ESCROW_PROGRAM_ID
  );

  return pda;
}
