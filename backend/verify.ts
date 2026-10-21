import "server-only";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { addPaymentRecord, recordAcceptedPayment } from "./db";
import { RejectionReason } from "../types/rejection";
import type { VerifyResult } from "../types/payment";

const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID!);
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const FEE_PAYER = Keypair.fromSecretKey(
  bs58.decode(process.env.FEE_PAYER_PRIVATE_KEY!)
);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");

const LOCK_DISCRIMINATOR = Buffer.from([
  21, 19, 208, 43, 237, 62, 255, 87,
]);
const ESCROW_ACCOUNT_DISCRIMINATOR = Buffer.from([
  31, 213, 123, 187, 186, 22, 218, 155,
]);

const ALLOWED_PROGRAMS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  ESCROW_PROGRAM_ID.toBase58(),
]);

const MIN_TIMEOUT_SECS = 60;
const MAX_TIMEOUT_SECS = 3600;
const MAX_COMPUTE_UNITS = 400_000;

type ParsedTokenAccount = {
  mint?: unknown;
  owner?: unknown;
  tokenAmount?: { amount?: unknown };
};

/** Verify a buyer-signed escrow lock before a seller delivers a resource. */
export async function verifyPayment(
  transactionBase64: string,
  expectedSeller: string,
  expectedAmount: string,
  expectedMint: string
): Promise<VerifyResult> {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
  } catch {
    return reject(RejectionReason.MalformedTransaction, "", expectedSeller, expectedAmount, expectedMint);
  }

  let sellerKey: PublicKey;
  let mintKey: PublicKey;
  let amountExpected: bigint;
  try {
    sellerKey = new PublicKey(expectedSeller);
    mintKey = new PublicKey(expectedMint);
    amountExpected = BigInt(expectedAmount);
  } catch {
    return reject(RejectionReason.MalformedTransaction, "", expectedSeller, expectedAmount, expectedMint);
  }

  const signature = tx.signature ? bs58.encode(tx.signature) : "";
  if (!signature || !tx.feePayer || !tx.recentBlockhash) {
    return reject(RejectionReason.MalformedTransaction, signature, expectedSeller, expectedAmount, expectedMint);
  }
  if (!tx.verifySignatures(true)) {
    return reject(RejectionReason.InvalidSignature, signature, expectedSeller, expectedAmount, expectedMint);
  }
  if (amountExpected <= BigInt(0) || amountExpected > BigInt("18446744073709551615")) {
    return reject(RejectionReason.WrongAmount, signature, expectedSeller, expectedAmount, expectedMint);
  }
  if (!mintKey.equals(USDC_MINT)) {
    return reject(RejectionReason.WrongMint, signature, expectedSeller, expectedAmount, expectedMint);
  }

  for (const ix of tx.instructions) {
    if (!ALLOWED_PROGRAMS.has(ix.programId.toBase58())) {
      return reject(RejectionReason.DisallowedProgram, signature, expectedSeller, expectedAmount, expectedMint);
    }
  }

  const escrowInstructions = tx.instructions.filter((ix) =>
    ix.programId.equals(ESCROW_PROGRAM_ID)
  );
  if (escrowInstructions.length !== 1) {
    return reject(RejectionReason.MalformedTransaction, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const lockIx = escrowInstructions[0];
  if (lockIx.data.length !== 32 || !lockIx.data.subarray(0, 8).equals(LOCK_DISCRIMINATOR)) {
    return reject(RejectionReason.MalformedTransaction, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const expectedAccounts = [
    { signer: true, writable: false },
    { signer: true, writable: true },
    { signer: false, writable: false },
    { signer: false, writable: false },
    { signer: false, writable: true },
    { signer: false, writable: true },
    { signer: false, writable: true },
    { signer: false, writable: false },
    { signer: false, writable: false },
  ];
  if (lockIx.keys.length !== expectedAccounts.length) {
    return reject(RejectionReason.MalformedTransaction, signature, expectedSeller, expectedAmount, expectedMint);
  }

  // Solana merges duplicate account metas when it serializes a transaction.
  // The demo uses the buyer as both buyer and payer, so that account is
  // writable in both serialized instruction positions.
  const accountShapeIsValid = lockIx.keys.every((key, index) => {
    const mergedSigner = lockIx.keys.some(
      (candidate, candidateIndex) =>
        candidate.pubkey.equals(key.pubkey) && expectedAccounts[candidateIndex].signer
    );
    const mergedWritable = lockIx.keys.some(
      (candidate, candidateIndex) =>
        candidate.pubkey.equals(key.pubkey) && expectedAccounts[candidateIndex].writable
    );

    return (
      key.isSigner === mergedSigner &&
      key.isWritable === mergedWritable &&
      index < expectedAccounts.length
    );
  });
  if (!accountShapeIsValid) {
    return reject(RejectionReason.MalformedTransaction, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const buyerKey = lockIx.keys[0].pubkey;
  const instructionMint = lockIx.keys[3].pubkey;
  if (!instructionMint.equals(mintKey)) {
    return reject(RejectionReason.WrongMint, signature, expectedSeller, expectedAmount, expectedMint);
  }
  if (!lockIx.keys[2].pubkey.equals(sellerKey)) {
    return reject(RejectionReason.WrongSeller, signature, expectedSeller, expectedAmount, expectedMint);
  }
  if (!tx.signatures.some((entry) => entry.publicKey.equals(buyerKey) && entry.signature)) {
    return reject(RejectionReason.InvalidSignature, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const escrowId = lockIx.data.readBigUInt64LE(8);
  const amount = lockIx.data.readBigUInt64LE(16);
  const timeout = lockIx.data.readBigInt64LE(24);
  if (amount !== amountExpected) {
    return reject(RejectionReason.WrongAmount, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const [expectedEscrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), buyerKey.toBuffer(), uint64Bytes(escrowId)],
    ESCROW_PROGRAM_ID
  );
  const [expectedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), expectedEscrow.toBuffer()],
    ESCROW_PROGRAM_ID
  );
  if (!lockIx.keys[4].pubkey.equals(expectedEscrow) || !lockIx.keys[6].pubkey.equals(expectedVault)) {
    return reject(RejectionReason.MalformedTransaction, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const timeoutSecs = timeout - nowSecs;
  if (timeoutSecs < BigInt(MIN_TIMEOUT_SECS) || timeoutSecs > BigInt(MAX_TIMEOUT_SECS)) {
    return reject(RejectionReason.InvalidTimeout, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const feePayerKey = FEE_PAYER.publicKey;
  for (const [index, key] of lockIx.keys.entries()) {
    if (key.pubkey.equals(feePayerKey) && index !== 1) {
      return reject(RejectionReason.FeePayerIsAuthority, signature, expectedSeller, expectedAmount, expectedMint);
    }
  }
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(ESCROW_PROGRAM_ID) && ix.keys.some((key) => key.pubkey.equals(feePayerKey))) {
      return reject(RejectionReason.FeePayerIsAuthority, signature, expectedSeller, expectedAmount, expectedMint);
    }
  }

  for (const ix of tx.instructions) {
    if (ix.programId.toBase58() === "ComputeBudget111111111111111111111111111111" && ix.data.length >= 5 && ix.data[0] === 2) {
      if (ix.data.readUInt32LE(1) > MAX_COMPUTE_UNITS) {
        return reject(RejectionReason.ComputeOverBudget, signature, expectedSeller, expectedAmount, expectedMint);
      }
    }
  }

  const status = (await connection.getSignatureStatuses([signature])).value[0];
  if (status?.err) {
    return reject(RejectionReason.TransactionFailed, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const existingEscrowReason = await validateExistingEscrow(
    expectedEscrow,
    buyerKey,
    sellerKey,
    mintKey,
    escrowId,
    amount
  );
  if (existingEscrowReason) {
    return reject(existingEscrowReason, signature, expectedSeller, expectedAmount, expectedMint);
  }

  const recorded = await recordAcceptedPayment({
    signature,
    buyer: buyerKey.toBase58(),
    seller: sellerKey.toBase58(),
    amount: expectedAmount,
    mint: mintKey.toBase58(),
    escrowAddress: expectedEscrow.toBase58(),
    escrowState: status ? "Locked" : null,
    accepted: true,
    rejectionReason: null,
  });
  if (!recorded) {
    return reject(RejectionReason.ReplayedSignature, signature, expectedSeller, expectedAmount, expectedMint);
  }

  return {
    accepted: true,
    signature,
    escrowAddress: expectedEscrow.toBase58(),
    state: status ? "Locked" : "Pre-submission",
  };
}

function uint64Bytes(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

async function validateExistingEscrow(
  escrowAddress: PublicKey,
  buyer: PublicKey,
  seller: PublicKey,
  mint: PublicKey,
  escrowId: bigint,
  amount: bigint
): Promise<RejectionReason | null> {
  let accountInfo;
  try {
    accountInfo = await connection.getAccountInfo(escrowAddress);
  } catch {
    return RejectionReason.EscrowNotFound;
  }
  if (!accountInfo) {
    return null;
  }
  if (!accountInfo.owner.equals(ESCROW_PROGRAM_ID) || accountInfo.data.length < 130) {
    return RejectionReason.EscrowNotFound;
  }

  const data = accountInfo.data;
  if (!data.subarray(0, 8).equals(ESCROW_ACCOUNT_DISCRIMINATOR)) {
    return RejectionReason.EscrowNotFound;
  }
  if (
    !new PublicKey(data.subarray(8, 40)).equals(buyer) ||
    !new PublicKey(data.subarray(40, 72)).equals(seller) ||
    !new PublicKey(data.subarray(72, 104)).equals(mint) ||
    data.readBigUInt64LE(104) !== amount ||
    data.readBigUInt64LE(120) !== escrowId ||
    data[128] !== 0
  ) {
    return RejectionReason.EscrowNotLocked;
  }

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrowAddress.toBuffer()],
    ESCROW_PROGRAM_ID
  );
  try {
    const vaultInfo = await connection.getParsedAccountInfo(vault);
    const parsedData = vaultInfo.value?.data;
    if (!parsedData || !("parsed" in parsedData)) {
      return RejectionReason.EscrowNotFunded;
    }
    const parsed = parsedData.parsed as { info?: ParsedTokenAccount };
    const info = parsed.info;
    if (
      !info ||
      info.mint !== mint.toBase58() ||
      info.owner !== escrowAddress.toBase58() ||
      info.tokenAmount?.amount !== amount.toString()
    ) {
      return RejectionReason.EscrowNotFunded;
    }
  } catch {
    return RejectionReason.EscrowNotFunded;
  }

  return null;
}

async function reject(
  reason: RejectionReason,
  signature: string,
  seller: string,
  amount: string,
  mint: string
): Promise<VerifyResult> {
  try {
    await addPaymentRecord({
      signature: signature || "unknown",
      buyer: "unknown",
      seller,
      amount,
      mint,
      escrowAddress: null,
      escrowState: null,
      accepted: false,
      rejectionReason: reason,
    });
  } catch {
    // Rejection must still be returned if logging fails.
  }
  return { accepted: false, reason };
}
