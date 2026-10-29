import "server-only";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../escrow/idl/escrow.json";
import { EscrowState } from "../types/escrow";
import type { EscrowAccount } from "../types/escrow";

class NodeWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof Transaction) tx.partialSign(this.payer);
    else tx.sign([this.payer]);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    txs.forEach((tx) => {
      if (tx instanceof Transaction) tx.partialSign(this.payer);
      else tx.sign([this.payer]);
    });
    return txs;
  }
}

type AnchorEscrowAccount = {
  buyer: PublicKey;
  seller: PublicKey;
  mint: PublicKey;
  amount: { toString(): string };
  timeout: { toString(): string };
  escrowId: { toString(): string };
  state: Record<string, unknown>;
  bump: number;
};

type EscrowAccountNamespace = {
  escrow: { fetch(address: PublicKey): Promise<unknown> };
};

const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID!);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const facilitatorKeypair = Keypair.fromSecretKey(
  bs58.decode(process.env.FACILITATOR_PRIVATE_KEY!),
);
const provider = new AnchorProvider(
  connection,
  new NodeWallet(facilitatorKeypair),
  {
    commitment: "confirmed",
  },
);
const program = new Program(idl as unknown as Idl, provider);
const stateMap: Record<string, EscrowState> = {
  locked: EscrowState.Locked,
  released: EscrowState.Released,
  refunded: EscrowState.Refunded,
};

export async function fetchEscrow(
  escrowAddress: string,
): Promise<EscrowAccount | null> {
  try {
    const pubkey = new PublicKey(escrowAddress);
    const accounts = program.account as unknown as EscrowAccountNamespace;
    const account = (await accounts.escrow.fetch(
      pubkey,
    )) as AnchorEscrowAccount;
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

export function deriveEscrowAddress(
  buyer: string,
  escrowId: bigint,
): PublicKey {
  const buyerPubkey = new PublicKey(buyer);
  const escrowIdBuffer = Buffer.alloc(8);
  escrowIdBuffer.writeBigUInt64LE(escrowId);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), buyerPubkey.toBuffer(), escrowIdBuffer],
    ESCROW_PROGRAM_ID,
  );
  return pda;
}

export function deriveVaultAddress(escrowAddress: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrowAddress.toBuffer()],
    ESCROW_PROGRAM_ID,
  );
  return pda;
}
