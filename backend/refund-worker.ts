import "server-only";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { getAutoRefundCandidates } from "./db";
import { fetchEscrow } from "./escrow";
import { refundEscrow } from "./settlement";
import { EscrowState } from "../types/escrow";

const REFUND_DISCRIMINATOR = Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]);
const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID!);
const workerState = globalThis as unknown as {
  ghostrailAutomaticRefundWorkerStarted?: boolean;
};
const inFlight = new Set<string>();

/** Start the opt-in devnet refund worker once per Node.js server instance. */
export function startAutomaticRefundWorker(): void {
  if (process.env.AUTO_REFUND_ENABLED !== "true") {
    return;
  }
  if (workerState.ghostrailAutomaticRefundWorkerStarted) {
    return;
  }
  if (!process.env.BUYER_PRIVATE_KEY) {
    console.error(
      "Automatic refunds are enabled but BUYER_PRIVATE_KEY is missing.",
    );
    return;
  }

  workerState.ghostrailAutomaticRefundWorkerStarted = true;
  void runRefundWorker();
}

async function runRefundWorker(): Promise<void> {
  const pollMs = parsePollInterval();
  const buyer = loadKeypair(process.env.BUYER_PRIVATE_KEY!);
  const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");

  console.log(`Automatic refund worker enabled; checking every ${pollMs}ms.`);
  while (true) {
    try {
      await scanLockedPayments(connection, buyer);
    } catch (error) {
      console.error(
        "Automatic refund worker scan failed:",
        error instanceof Error ? error.message : error,
      );
    }
    await delay(pollMs);
  }
}

async function scanLockedPayments(
  connection: Connection,
  buyer: Keypair,
): Promise<void> {
  const candidates = await getAutoRefundCandidates();
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (const candidate of candidates) {
    if (inFlight.has(candidate.escrowAddress)) continue;

    const escrow = await fetchEscrow(candidate.escrowAddress);
    if (
      !escrow ||
      escrow.state !== EscrowState.Locked ||
      escrow.buyer !== buyer.publicKey.toBase58() ||
      escrow.timeout > now
    ) {
      continue;
    }

    const serviceResults = await Promise.all(
      candidate.serviceUrls.map((url) => checkServiceAvailability(url)),
    );
    const serviceAvailable = serviceResults.some(Boolean);
    if (serviceAvailable) continue;

    inFlight.add(candidate.escrowAddress);
    void submitAutomaticRefund(connection, buyer, candidate.escrowAddress)
      .catch((error) => {
        console.error(
          `Automatic refund failed for ${candidate.escrowAddress}:`,
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => inFlight.delete(candidate.escrowAddress));
  }
}

async function checkServiceAvailability(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    // A 402 or other 4xx response proves the endpoint is reachable. Only a
    // network failure or server-side 5xx response counts as unavailable.
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function submitAutomaticRefund(
  connection: Connection,
  buyer: Keypair,
  escrowAddress: string,
): Promise<void> {
  const escrow = await fetchEscrow(escrowAddress);
  if (
    !escrow ||
    escrow.state !== EscrowState.Locked ||
    escrow.buyer !== buyer.publicKey.toBase58()
  ) {
    return;
  }

  const escrowPubkey = new PublicKey(escrowAddress);
  const facilitator = loadKeypair(
    process.env.FACILITATOR_PRIVATE_KEY!,
  ).publicKey;
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrowPubkey.toBuffer()],
    ESCROW_PROGRAM_ID,
  );
  const buyerToken = await getOrCreateAssociatedTokenAccount(
    connection,
    buyer,
    new PublicKey(escrow.mint),
    buyer.publicKey,
  );
  const instruction = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    data: REFUND_DISCRIMINATOR,
    keys: [
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      {
        pubkey: new PublicKey(escrow.seller),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: new PublicKey(escrow.mint),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: escrowPubkey, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: buyerToken.address, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = facilitator;
  transaction.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  transaction.partialSign(buyer);

  const result = await refundEscrow(
    escrowAddress,
    transaction
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString("base64"),
  );
  if (!result.success) {
    throw new Error(result.error ?? "Refund was rejected");
  }
  console.log(
    `Automatic refund submitted for ${escrowAddress}: ${result.signature}`,
  );
}

function loadKeypair(value: string): Keypair {
  try {
    return Keypair.fromSecretKey(bs58.decode(value));
  } catch {
    throw new Error("Configured automatic-refund private key is invalid");
  }
}

function parsePollInterval(): number {
  const configured = Number(process.env.AUTO_REFUND_POLL_MS ?? "30000");
  return Number.isFinite(configured) && configured >= 5000 ? configured : 30000;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
