/**
 * Every rejection gets exactly one reason. The facilitator returns this
 * to the seller so the buyer's agent can understand *why* it was rejected.
 */
export enum RejectionReason {
  /** Transaction contains programs that are not in the allowlist. */
  DisallowedProgram = "DISALLOWED_PROGRAM",
  /** No escrow lock instruction found in the transaction. */
  MissingLockInstruction = "MISSING_LOCK_INSTRUCTION",
  /** The token mint in the lock instruction doesn't match. */
  WrongMint = "WRONG_MINT",
  /** The lock amount doesn't match the expected price. */
  WrongAmount = "WRONG_AMOUNT",
  /** The buyer in the lock instruction doesn't match. */
  WrongBuyer = "WRONG_BUYER",
  /** The seller in the lock instruction doesn't match. */
  WrongSeller = "WRONG_SELLER",
  /** The escrow account does not exist on-chain. */
  EscrowNotFound = "ESCROW_NOT_FOUND",
  /** The escrow account is not in the Locked state. */
  EscrowNotLocked = "ESCROW_NOT_LOCKED",
  /** The escrow vault is not funded (balance mismatch). */
  EscrowNotFunded = "ESCROW_NOT_FUNDED",
  /** The timeout on the escrow is outside allowed bounds. */
  InvalidTimeout = "INVALID_TIMEOUT",
  /** The fee-payer is used as an authority, which is not allowed. */
  FeePayerIsAuthority = "FEE_PAYER_IS_AUTHORITY",
  /** Compute budget exceeds allowed limits. */
  ComputeOverBudget = "COMPUTE_OVER_BUDGET",
  /** This exact signature was already accepted (replay attempt). */
  ReplayedSignature = "REPLAYED_SIGNATURE",
  /** The transaction is malformed or failed to deserialize. */
  MalformedTransaction = "MALFORMED_TRANSACTION",
  InvalidSignature = "INVALID_SIGNATURE",
  /** The transaction was already submitted and failed on-chain. */
  TransactionFailed = "TRANSACTION_FAILED",
  /** Settlement (release/refund) failed on-chain. */
  SettlementFailed = "SETTLEMENT_FAILED",
}
