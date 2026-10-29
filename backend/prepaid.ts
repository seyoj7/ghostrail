import "server-only";

import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import {
  addPaymentRecord,
  findPaymentBySignature,
  recordAcceptedPayment,
  updatePaymentBySignature,
} from "./db";
import { RejectionReason } from "../types/rejection";
import type { VerifyResult } from "../types/payment";

const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID!);
const USDC_MINT = new PublicKey(process.env.USDC_MINT!);
const MAX_CREDIT_BALANCE = BigInt("100000000");
const MIN_CREDIT_DEPOSIT = BigInt("1000000");
const CREDIT_ACCOUNT_SIZE = 121;
const CREDIT_DISCRIMINATOR = createHash("sha256")
  .update("account:Credit")
  .digest()
  .subarray(0, 8);
const DEPOSIT_DISCRIMINATOR = instructionDiscriminator("deposit_credit");
const CHARGE_DISCRIMINATOR = instructionDiscriminator("charge_credit");

export interface CreditAccount {
  address: string;
  buyer: string;
  seller: string;
  mint: string;
  balance: bigint;
  nextNonce: bigint;
  bump: number;
}

export function deriveCreditAddress(
  buyer: string,
  seller: string,
  mint = USDC_MINT.toBase58(),
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("credit"),
      new PublicKey(buyer).toBuffer(),
      new PublicKey(seller).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ESCROW_PROGRAM_ID,
  );
  return address;
}

export async function fetchCredit(address: string): Promise<CreditAccount | null> {
  let creditAddress: PublicKey;
  try {
    creditAddress = new PublicKey(address);
  } catch {
    return null;
  }
  const account = await connection.getAccountInfo(creditAddress, "confirmed");
  if (
    !account ||
    !account.owner.equals(ESCROW_PROGRAM_ID) ||
    account.data.length < CREDIT_ACCOUNT_SIZE ||
    !account.data.subarray(0, 8).equals(CREDIT_DISCRIMINATOR)
  ) {
    return null;
  }

  const data = account.data;
  const credit: CreditAccount = {
    address: creditAddress.toBase58(),
    buyer: new PublicKey(data.subarray(8, 40)).toBase58(),
    seller: new PublicKey(data.subarray(40, 72)).toBase58(),
    mint: new PublicKey(data.subarray(72, 104)).toBase58(),
    balance: data.readBigUInt64LE(104),
    nextNonce: data.readBigUInt64LE(112),
    bump: data[120],
  };

  const vault = deriveVaultAddress(creditAddress);
  const [vaultAccount, vaultBalance] = await Promise.all([
    connection.getParsedAccountInfo(vault, "confirmed"),
    connection.getTokenAccountBalance(vault, "confirmed").catch(() => null),
  ]);
  const parsedData = vaultAccount.value?.data;
  if (
    !parsedData ||
    !("parsed" in parsedData) ||
    vaultBalance?.value.amount !== credit.balance.toString()
  ) {
    return null;
  }
  const parsed = parsedData.parsed as {
    info?: { mint?: unknown; owner?: unknown };
  };
  if (
    parsed.info?.mint !== credit.mint ||
    parsed.info?.owner !== credit.address
  ) {
    return null;
  }
  return credit;
}

export async function verifyCreditPayment(
  transactionBase64: string,
  expectedSeller: string,
  expectedAmount: string,
  expectedMint: string,
): Promise<VerifyResult> {
  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
  } catch {
    return reject(
      RejectionReason.MalformedTransaction,
      "",
      expectedSeller,
      expectedAmount,
      expectedMint,
    );
  }

  const validation = await validateChargeTransaction(transaction, {
    expectedSeller,
    expectedAmount,
    expectedMint,
  });
  if (!validation.ok) {
    return reject(
      validation.reason,
      validation.signature,
      expectedSeller,
      expectedAmount,
      expectedMint,
    );
  }

  const status = (
    await connection.getSignatureStatuses([validation.signature])
  ).value[0];
  if (status) {
    return reject(
      status.err
        ? RejectionReason.TransactionFailed
        : RejectionReason.ReplayedSignature,
      validation.signature,
      expectedSeller,
      expectedAmount,
      expectedMint,
    );
  }

  const recorded = await recordAcceptedPayment({
    signature: validation.signature,
    buyer: validation.buyer,
    seller: validation.seller,
    amount: expectedAmount,
    mint: validation.mint,
    escrowAddress: validation.creditAddress,
    escrowState: "Prepaid",
    accepted: true,
    rejectionReason: null,
  });
  if (!recorded) {
    return reject(
      RejectionReason.ReplayedSignature,
      validation.signature,
      expectedSeller,
      expectedAmount,
      expectedMint,
    );
  }

  return {
    accepted: true,
    signature: validation.signature,
    escrowAddress: validation.creditAddress,
    creditAddress: validation.creditAddress,
    creditBalance: validation.balance.toString(),
    state: "Prepaid",
    transaction: transactionBase64,
  };
}

/** Validate and confirm the buyer's one-time deposit/top-up transaction. */
export async function submitCreditDeposit(
  transactionBase64: string,
): Promise<{ success: boolean; signature?: string; creditAddress?: string; balance?: string; error?: string }> {
  try {
    const transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
    const instruction = transaction.instructions.length === 1
      ? transaction.instructions[0]
      : undefined;
    if (!instruction) {
      return { success: false, error: "Deposit must contain exactly one instruction" };
    }
    if (!instruction.programId.equals(ESCROW_PROGRAM_ID)) {
      return { success: false, error: "Deposit instruction targets a different escrow program; check the service and facilitator ESCROW_PROGRAM_ID settings" };
    }
    if (
      instruction.data.length !== 16 ||
      !instruction.data.subarray(0, 8).equals(DEPOSIT_DISCRIMINATOR)
    ) {
      return { success: false, error: "Deposit instruction data is invalid; check that the buyer client and facilitator use matching versions" };
    }
    if (!transaction.feePayer || !transaction.recentBlockhash) {
      return { success: false, error: "Deposit transaction is missing its fee payer or recent blockhash" };
    }
    if (!transaction.verifySignatures(true)) {
      return { success: false, error: "Deposit signature is missing or invalid; check BUYER_PRIVATE_KEY and buyer client serialization" };
    }

    const keys = instruction.keys;
    if (keys.length !== 10) {
      return { success: false, error: "Deposit accounts do not match the program" };
    }
    const [buyer, seller, mint, credit, buyerToken, vault, sellerToken, system, token, associated] = keys;
    const amount = instruction.data.readBigUInt64LE(8);
    const signature = transaction.signature
      ? bs58.encode(transaction.signature)
      : "";
    if (!signature) return { success: false, error: "Deposit transaction has no buyer signature" };
    if (!transaction.feePayer.equals(buyer.pubkey)) return { success: false, error: "Deposit fee payer must be the buyer" };
    if (!buyer.isSigner || !buyer.isWritable) return { success: false, error: "Buyer account must sign and be writable" };
    if (seller.isSigner || seller.isWritable) return { success: false, error: "Seller account must be read-only and must not sign" };
    if (mint.isSigner || mint.isWritable) return { success: false, error: "USDC mint account must be read-only and must not sign" };
    if (!credit.isWritable || !buyerToken.isWritable || !vault.isWritable || !sellerToken.isWritable) {
      return { success: false, error: "Credit, vault, and token accounts must be writable" };
    }
    if (!system.pubkey.equals(SystemProgram.programId)) return { success: false, error: "Deposit has the wrong system program account" };
    if (!token.pubkey.equals(TOKEN_PROGRAM_ID)) return { success: false, error: "Deposit has the wrong SPL token program account" };
    if (!associated.pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return { success: false, error: "Deposit has the wrong associated token program account" };
    if (amount < MIN_CREDIT_DEPOSIT || amount > MAX_CREDIT_BALANCE) {
      return { success: false, error: "Deposit must be between 1 and 100 USDC" };
    }

    const buyerAddress = buyer.pubkey;
    const sellerAddress = seller.pubkey;
    const mintAddress = mint.pubkey;
    if (
      !mintAddress.equals(USDC_MINT) ||
      !credit.pubkey.equals(deriveCreditAddress(
        buyerAddress.toBase58(), sellerAddress.toBase58(), mintAddress.toBase58(),
      )) ||
      !vault.pubkey.equals(deriveVaultAddress(credit.pubkey)) ||
      !buyerToken.pubkey.equals(getAssociatedTokenAddressSync(mintAddress, buyerAddress)) ||
      !sellerToken.pubkey.equals(getAssociatedTokenAddressSync(mintAddress, sellerAddress))
    ) {
      return { success: false, error: "Deposit addresses do not match buyer, seller, and USDC" };
    }

    const before = await fetchCredit(credit.pubkey.toBase58());
    const previousBalance = before?.balance ?? BigInt(0);
    if (previousBalance + amount > MAX_CREDIT_BALANCE) {
      return { success: false, error: "Total prepaid balance cannot exceed 100 USDC" };
    }
    const submission = await submitAndConfirm(transaction, signature);
    const updated = await fetchCredit(credit.pubkey.toBase58());
    if (!updated || updated.balance !== previousBalance + amount) {
      return { success: false, error: "Confirmed deposit did not match the expected credit balance" };
    }
    return {
      success: true,
      signature: submission,
      creditAddress: updated.address,
      balance: updated.balance.toString(),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Submit a charge only after the seller has successfully handled the request. */
export async function settleCreditCharge(
  creditAddress: string,
  signature: string,
  transactionBase64: string,
): Promise<{ success: boolean; signature?: string; amount?: string; remainingBalance?: string; error?: string }> {
  try {
    const record = await findPaymentBySignature(signature);
    if (
      !record ||
      !record.accepted ||
      record.escrowAddress !== creditAddress ||
      record.escrowState !== "Prepaid"
    ) {
      return { success: false, error: "No verified prepaid authorization matches this charge" };
    }
    const transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
    const validation = await validateChargeTransaction(transaction, {
      expectedCreditAddress: creditAddress,
      expectedBuyer: record.buyer,
      expectedSeller: record.seller,
      expectedAmount: record.amount,
      expectedMint: record.mint,
      expectedSignature: signature,
      allowConfirmed: true,
    });
    if (!validation.ok) {
      return { success: false, error: `Charge validation failed: ${validation.reason}` };
    }

    const confirmedSignature = await submitAndConfirm(transaction, signature);
    const remaining = await fetchCredit(creditAddress);
    if (!remaining) {
      return { success: false, error: "Credit account was not readable after charge confirmation" };
    }
    await updatePaymentBySignature(signature, {
      escrowState: "Released",
      settledAt: new Date().toISOString(),
    });
    return {
      success: true,
      signature: confirmedSignature,
      amount: validation.amount.toString(),
      remainingBalance: remaining.balance.toString(),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function deriveVaultAddress(credit: PublicKey): PublicKey {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), credit.toBuffer()],
    ESCROW_PROGRAM_ID,
  );
  return vault;
}

type ChargeExpectations = {
  expectedSeller?: string;
  expectedAmount?: string;
  expectedMint?: string;
  expectedCreditAddress?: string;
  expectedBuyer?: string;
  expectedSignature?: string;
  allowConfirmed?: boolean;
};

async function validateChargeTransaction(
  transaction: Transaction,
  expected: ChargeExpectations,
): Promise<
  | {
      ok: true;
      signature: string;
      buyer: string;
      seller: string;
      mint: string;
      creditAddress: string;
      amount: bigint;
      balance: bigint;
      nonce: bigint;
    }
  | { ok: false; reason: RejectionReason; signature: string }
> {
  const signature = transaction.signature
    ? bs58.encode(transaction.signature)
    : "";
  const fail = (reason: RejectionReason) => ({ ok: false as const, reason, signature });
  if (
    !signature ||
    (expected.expectedSignature && signature !== expected.expectedSignature) ||
    !transaction.feePayer ||
    !transaction.recentBlockhash ||
    !transaction.verifySignatures(true) ||
    transaction.instructions.length !== 1
  ) {
    return fail(RejectionReason.InvalidSignature);
  }
  const instruction = transaction.instructions[0];
  if (
    !instruction.programId.equals(ESCROW_PROGRAM_ID) ||
    instruction.data.length !== 24 ||
    !instruction.data.subarray(0, 8).equals(CHARGE_DISCRIMINATOR) ||
    instruction.keys.length !== 7
  ) {
    return fail(RejectionReason.MalformedTransaction);
  }
  const [buyer, seller, mint, credit, vault, sellerToken, token] = instruction.keys;
  const amount = instruction.data.readBigUInt64LE(8);
  const nonce = instruction.data.readBigUInt64LE(16);
  if (
    !buyer.isSigner ||
    !buyer.isWritable ||
    seller.isSigner ||
    seller.isWritable ||
    mint.isSigner ||
    mint.isWritable ||
    !credit.isWritable ||
    !vault.isWritable ||
    !sellerToken.isWritable ||
    !token.pubkey.equals(TOKEN_PROGRAM_ID) ||
    !transaction.feePayer.equals(buyer.pubkey) ||
    amount === BigInt(0)
  ) {
    return fail(RejectionReason.MalformedTransaction);
  }
  const derivedCredit = deriveCreditAddress(
    buyer.pubkey.toBase58(),
    seller.pubkey.toBase58(),
    mint.pubkey.toBase58(),
  );
  if (
    !mint.pubkey.equals(USDC_MINT) ||
    !credit.pubkey.equals(derivedCredit) ||
    !vault.pubkey.equals(deriveVaultAddress(derivedCredit)) ||
    !sellerToken.pubkey.equals(getAssociatedTokenAddressSync(mint.pubkey, seller.pubkey))
  ) {
    return fail(RejectionReason.MalformedTransaction);
  }
  if (
    (expected.expectedSeller && seller.pubkey.toBase58() !== expected.expectedSeller) ||
    (expected.expectedAmount && amount !== BigInt(expected.expectedAmount)) ||
    (expected.expectedMint && mint.pubkey.toBase58() !== expected.expectedMint) ||
    (expected.expectedBuyer && buyer.pubkey.toBase58() !== expected.expectedBuyer) ||
    (expected.expectedCreditAddress && credit.pubkey.toBase58() !== expected.expectedCreditAddress)
  ) {
    return fail(
      expected.expectedSeller && seller.pubkey.toBase58() !== expected.expectedSeller
        ? RejectionReason.WrongSeller
        : expected.expectedMint && mint.pubkey.toBase58() !== expected.expectedMint
          ? RejectionReason.WrongMint
          : expected.expectedBuyer && buyer.pubkey.toBase58() !== expected.expectedBuyer
            ? RejectionReason.WrongBuyer
            : RejectionReason.WrongAmount,
    );
  }
  const status = (await connection.getSignatureStatuses([signature])).value[0];
  if (status?.err) return fail(RejectionReason.TransactionFailed);
  if (status && !expected.allowConfirmed) {
    return fail(RejectionReason.ReplayedSignature);
  }

  const account = await fetchCredit(credit.pubkey.toBase58());
  if (
    !account ||
    account.buyer !== buyer.pubkey.toBase58() ||
    account.seller !== seller.pubkey.toBase58() ||
    account.mint !== mint.pubkey.toBase58()
  ) {
    return fail(RejectionReason.CreditNotFound);
  }
  if (account.nextNonce !== nonce) return fail(RejectionReason.InvalidCreditNonce);
  if (account.balance < amount) return fail(RejectionReason.InsufficientCredit);
  return {
    ok: true,
    signature,
    buyer: account.buyer,
    seller: account.seller,
    mint: account.mint,
    creditAddress: account.address,
    amount,
    balance: account.balance,
    nonce,
  };
}

async function submitAndConfirm(
  transaction: Transaction,
  signature: string,
): Promise<string> {
  const status = (await connection.getSignatureStatuses([signature])).value[0];
  if (status?.err) throw new Error("Transaction already failed on-chain");
  if (!status) {
    try {
      const submitted = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      if (submitted !== signature) throw new Error("Transaction signature changed during submission");
    } catch {
      // The first submission may have landed even if its RPC response was lost.
    }
  }
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error("Transaction failed on-chain");
  return signature;
}

async function reject(
  reason: RejectionReason,
  signature: string,
  seller: string,
  amount: string,
  mint: string,
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
    // Return the verification result even if rejection logging fails.
  }
  return { accepted: false, reason };
}

function instructionDiscriminator(name: string): Buffer {
  return createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}
